package com.fengyi.ordershow.order;

import static com.fengyi.ordershow.order.OrderData.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.security.AdminPrincipal;
import static com.fengyi.ordershow.order.OrderPricingCalculator.calculatePrice;
import static com.fengyi.ordershow.order.OrderPricingCalculator.calculateTons;
import static com.fengyi.ordershow.order.OrderPricingCalculator.samePriceValue;

import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
  private final OrderRepository repository;
  private final ActivityService activities;
  private final DashboardService dashboards;
  private final ObjectMapper json;
  private final OrderQueryService queries;
  private final OrderExportService exports;
  private final OrderChangeRequestRepository changeRequests;

  public OrderService(OrderRepository repository, ActivityService activities, DashboardService dashboards, ObjectMapper json,
                      OrderQueryService queries, OrderExportService exports, OrderChangeRequestRepository changeRequests) {
    this.repository = repository;
    this.activities = activities;
    this.dashboards = dashboards;
    this.json = json;
    this.queries = queries;
    this.exports = exports;
    this.changeRequests = changeRequests;
  }

  @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public OrderView current(String activityCode, H5Principal customer) {
    return current(activityCode, customer, true);
  }

  @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public OrderView current(String activityCode, H5Principal customer, boolean includeHistory) {
    var activity = activities.orderingActivity(activityCode);
    requireIdentity(activity.id(), customer);
    return repository.findByCustomer(activity.id(), customer.customerId(), includeHistory);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public OrderView submit(String activityCode, H5Principal customer, SubmitRequest request, String idempotencyKey, String traceId) {
    return submit(activityCode, customer, request, idempotencyKey, traceId, true);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public OrderView submit(String activityCode, H5Principal customer, SubmitRequest request, String idempotencyKey, String traceId, boolean includeHistory) {
    return submit(activityCode, customer, request, idempotencyKey, traceId, includeHistory, () -> {});
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public OrderView submit(String activityCode, H5Principal customer, SubmitRequest request, String idempotencyKey,
                          String traceId, boolean includeHistory, Runnable onReplay) {
    var activity = activities.orderingActivity(activityCode);
    requireIdentity(activity.id(), customer);
    repository.lockCustomerSubmission(activity.id(), customer.customerId());
    if (request.items() == null || request.items().isEmpty()) throw DomainException.unprocessable("ORDER_EMPTY", "请至少选择一种商品");
    if (request.items().size() > 1000) throw DomainException.unprocessable("ORDER_TOO_MANY_ITEMS", "订单商品种类过多");
    Map<Long, Long> quantities = new LinkedHashMap<>();
    for (SubmitItem item : request.items()) {
      if (item == null || item.productId() <= 0 || item.quantity() <= 0 || item.quantity() > 999_999) throw DomainException.unprocessable("ORDER_ITEM_INVALID", "商品和订货箱数必须有效");
      if (quantities.put(item.productId(), item.quantity()) != null) throw DomainException.unprocessable("ORDER_ITEM_DUPLICATE", "同一商品不能重复提交");
    }
    OrderView replay = repository.beginH5Submission(activity.id(), customer.customerId(), idempotencyKey,
        H5SubmitFingerprint.digest(request, includeHistory), hash(request));
    if (replay != null) {
      onReplay.run();
      return replay;
    }
    activities.requireWritable(activity.id());
    OrderRow current = repository.lockOrder(activity.id(), customer.customerId());
    if (current != null) {
      repository.cancelH5Submission(activity.id(), customer.customerId(), idempotencyKey);
      throw DomainException.conflict("ORDER_CHANGE_REVIEW_REQUIRED", "已有订单的修改需要提交后台审核");
    }
    int currentVersion = current == null ? 0 : current.version();
    if (request.expectedVersion() != currentVersion) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已在其他页面更新，请刷新后重试");
    if (current != null && "VOIDED".equals(current.status())) {
      throw DomainException.conflict("ORDER_VOIDED", "订单已由管理员作废，请联系管理员处理");
    }
    List<ProductSnapshot> products = repository.loadProducts(activity.id(), customer.customerId(), customer.customerType(), customer.branchName(), quantities.keySet());
    if (products.size() != quantities.size()) throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "订单中包含不可订、已删除或不属于当前客户的商品");
    if (current != null && "SUBMITTED".equals(current.status()) && repository.sameItems(current.id(), quantities)) {
      repository.deleteDraft(activity.id(), customer.customerId());
      OrderView result = repository.order(current.id(), includeHistory);
      repository.completeH5Submission(activity.id(), customer.customerId(), idempotencyKey, result);
      return result;
    }

    List<CalculatedItem> items = new ArrayList<>();
    long totalQuantity = 0;
    BigDecimal totalAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal totalTons = BigDecimal.ZERO.setScale(6);
    boolean tonsAvailable = true;
    int line = 0;
    for (ProductSnapshot product : products) {
      long quantity = quantities.get(product.id());
      PricingResult pricing = calculatePrice(product.casePrice(), product.priceTierMinQuantity(), product.priceTierCasePrice(), product.priceTierPricingMode(), quantity);
       BigDecimal lineTons = calculateTons(quantity, product.tonCaseFactor());
      items.add(new CalculatedItem(++line, product, quantity, pricing, lineTons));
      totalQuantity += quantity;
      totalAmount = totalAmount.add(pricing.lineAmount());
      if (lineTons == null) tonsAvailable = false; else totalTons = totalTons.add(lineTons);
    }
    if (!tonsAvailable) totalTons = null;
    int nextVersion = currentVersion + 1;
    boolean first = current == null;
    boolean resubmit = current != null && "WITHDRAWN".equals(current.status());
    long orderId;
    if (first) {
      orderId = repository.insertH5Order(activity.id(), customer, totalQuantity, totalTons, totalAmount);
    } else {
      int changed = repository.updateH5Order(nextVersion, totalQuantity, totalTons, totalAmount, current, currentVersion);
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已在其他页面更新，请刷新后重试");
      orderId = current.id();
      repository.deleteCurrentItems(orderId);
    }
    repository.insertCurrentItems(orderId, items);
    long versionId = repository.insertVersion(activity.id(), orderId, nextVersion, customer, totalQuantity, totalTons, totalAmount, idempotencyKey);
    repository.insertVersionItems(versionId, items);
    repository.insertH5Submission(activity.id(), orderId, first ? "FIRST_SUBMIT" : resubmit ? "RESUBMIT" : "MODIFY_SUBMIT", nextVersion, traceId);
    repository.writeOutbox(activity.id(), orderId, "ORDER_SUBMITTED", Map.of("orderId", orderId, "version", nextVersion));
    repository.deleteDraft(activity.id(), customer.customerId());
    OrderView result = repository.order(orderId, includeHistory);
    repository.completeH5Submission(activity.id(), customer.customerId(), idempotencyKey, result);
    return result;
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public OrderView withdraw(String activityCode, H5Principal customer, int expectedVersion, String idempotencyKey, String traceId) {
    return withdraw(activityCode, customer, expectedVersion, idempotencyKey, traceId, true);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public OrderView withdraw(String activityCode, H5Principal customer, int expectedVersion, String idempotencyKey, String traceId, boolean includeHistory) {
    var activity = activities.orderingActivity(activityCode);
    requireIdentity(activity.id(), customer);
    activities.requireWritable(activity.id());
    repository.lockCustomerSubmission(activity.id(), customer.customerId());
    OrderRow order = repository.lockOrder(activity.id(), customer.customerId());
    if (order == null) throw DomainException.notFound("ORDER_NOT_FOUND", "尚未提交订单");
    throw DomainException.conflict("ORDER_CHANGE_REVIEW_REQUIRED", "已有订单的撤回需要提交后台审核");
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public ChangeRequestView createH5ChangeRequest(String activityCode, H5Principal customer, ChangeRequestRequest request,
                                                 String idempotencyKey, String traceId) {
    var activity = activities.orderingActivity(activityCode);
    requireIdentity(activity.id(), customer);
    if (request == null) throw DomainException.badRequest("ORDER_CHANGE_REQUEST_INVALID", "订单变更申请不能为空");
    repository.lockCustomerSubmission(activity.id(), customer.customerId());
    String requestType = normalizeChangeRequestType(request.requestType());
    IdempotencyResult replay = repository.beginIdempotency(activity.id(), "H5_CUSTOMER", customer.customerId(),
        "ORDER_CHANGE_REQUEST", idempotencyKey, hash(request));
    if (replay.replay()) {
      OrderChangeRequestRow existing = changeRequests.byIdempotency(activity.id(), customer.customerId(), idempotencyKey);
      if (existing == null) throw DomainException.conflict("REQUEST_REPLAY_RESULT_MISSING", "此前申请结果不存在，请刷新订单");
      return changeRequestView(existing);
    }
    activities.requireWritable(activity.id());
    repository.lockCustomerSubmission(activity.id(), customer.customerId());
    OrderRow current = repository.lockOrder(activity.id(), customer.customerId());
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "尚未提交订单");
    if (current.version() != request.expectedVersion()) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单版本已变化，请刷新后重试");
    if ("VOIDED".equals(current.status())) throw DomainException.conflict("ORDER_VOIDED", "订单已由管理员作废，请联系管理员处理");
    if ("WITHDRAW".equals(requestType) && "WITHDRAWN".equals(current.status())) {
      throw DomainException.conflict("ORDER_ALREADY_WITHDRAWN", "订单已经撤回");
    }
    CustomerSnapshot customerSnapshot = repository.orderCustomer(activity.id(), customer.customerId());
    CalculatedOrder calculated;
    if ("MODIFY".equals(requestType)) {
      calculated = calculate(activity.id(), customerSnapshot, request.items());
    } else {
      calculated = new CalculatedOrder(List.of(), 0, null, null);
    }
    String itemsJson = writeChangeItems(calculated.items());
    changeRequests.rejectPending(current.id(), "已被客户新申请替代");
    long requestId = changeRequests.insert(activity.id(), current.id(), customer.customerId(), requestType, current.version(), current.lockVersion(),
        "MODIFY".equals(requestType) ? calculated.totalQuantity() : null,
        "MODIFY".equals(requestType) ? calculated.totalTons() : null,
        "MODIFY".equals(requestType) ? calculated.totalAmount() : null,
        itemsJson, optionalReason(request.customerNote()), idempotencyKey);
    try { changeRequests.saveOriginal(requestId,json.writeValueAsString(repository.order(current.id(),false))); }
    catch (java.io.IOException e) { throw new IllegalStateException("原订单快照保存失败",e); }
    repository.deleteDraft(activity.id(), customer.customerId());
    repository.insertOperation(activity.id(), current.id(), "H5_CHANGE_REQUESTED", "H5", null, current.version(),
        "MODIFY".equals(requestType) ? "提交订单修改申请" : "提交订单撤回申请", traceId);
    repository.completeIdempotency(activity.id(), "H5_CUSTOMER", customer.customerId(), "ORDER_CHANGE_REQUEST", idempotencyKey, requestId);
    return changeRequestView(changeRequests.byIdForUpdate(activity.id(), requestId));
  }

  @Transactional(readOnly = true)
  public ChangeRequestView currentH5ChangeRequest(String activityCode, H5Principal customer) {
    var activity = activities.orderingActivity(activityCode);
    requireIdentity(activity.id(), customer);
    return changeRequestView(changeRequests.pendingForCustomer(activity.id(), customer.customerId()));
  }

  @Transactional(readOnly = true)
  public List<ChangeRequestView> adminChangeRequests(long activityId, String status) {
    requireAdminOrderWritable(activityId);
    return changeRequests.list(activityId, status, 200).stream().map(this::changeRequestView).toList();
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public ChangeRequestView approveChangeRequest(long activityId, long requestId, String reviewReason, AdminPrincipal admin,
                                                String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    repository.lockPricing(activityId);
    String note = optionalReason(reviewReason);
    IdempotencyResult replay = repository.beginIdempotency(activityId, "ADMIN", admin.id(), "ORDER_CHANGE_APPROVE",
        idempotencyKey, hash(Map.of("requestId", requestId, "reason", note == null ? "" : note)));
    if (replay.replay()) {
      OrderChangeRequestRow existing = changeRequests.byIdForUpdate(activityId, requestId);
      if (existing == null) throw DomainException.notFound("ORDER_CHANGE_REQUEST_NOT_FOUND", "订单变更申请不存在");
      return changeRequestView(existing);
    }
    OrderChangeRequestRow request = changeRequests.byIdForUpdate(activityId, requestId);
    if (request == null) throw DomainException.notFound("ORDER_CHANGE_REQUEST_NOT_FOUND", "订单变更申请不存在");
    if (!"PENDING".equals(request.status())) throw DomainException.conflict("ORDER_CHANGE_REQUEST_STATUS", "该申请已处理");
    OrderRow current = repository.lockOrderById(activityId, request.orderId());
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    if (current.version()!=request.baseVersion() || current.lockVersion()!=request.baseLockVersion() || "VOIDED".equals(current.status())) {
      changeRequests.conflict(request.id(), "订单已发生变化，本次申请失效，请重新提交");
      repository.completeIdempotency(activityId,"ADMIN",admin.id(),"ORDER_CHANGE_APPROVE",idempotencyKey,request.id());
      return changeRequestView(changeRequests.byIdForUpdate(activityId,request.id()));
    }
    CustomerSnapshot customer = repository.orderCustomer(activityId, request.customerId());
    int version = current.version();
    String reason = "H5订单变更申请 #" + request.id() + " 审核通过" + (note == null ? "" : "：" + note);
    if ("MODIFY".equals(request.requestType())) {
      CalculatedOrder calculated = calculate(activityId, customer, requestItems(request));
      int changed = repository.adjustOrder(activityId, request.orderId(), current, version + 1, calculated, admin.id());
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
      repository.deleteCurrentItems(request.orderId());
      repository.insertCurrentItems(request.orderId(), calculated.items());
      long versionId = repository.insertVersion(activityId, request.orderId(), version + 1, customer, calculated.totalQuantity(), calculated.totalTons(),
          calculated.totalAmount(), "ADMIN", admin.id(), reason, idempotencyKey);
      repository.insertVersionItems(versionId, calculated.items());
      repository.insertOperation(activityId, request.orderId(), "H5_CHANGE_APPROVED", "ADMIN", admin.id(), version + 1, reason, traceId);
      afterAdminOrderChange(activity, request.orderId(), "ORDER_CHANGE_APPROVED", version + 1);
    } else {
      int changed = repository.withdrawOrderByAdmin(activityId, request.orderId(), current, reason, admin.id());
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
      repository.insertOperation(activityId, request.orderId(), "H5_CHANGE_APPROVED", "ADMIN", admin.id(), version, reason, traceId);
      afterAdminOrderChange(activity, request.orderId(), "ORDER_CHANGE_APPROVED", version);
    }
    changeRequests.review(request.id(), "APPROVED", note, admin.id());
    repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ORDER_CHANGE_APPROVE", idempotencyKey, request.id());
    return changeRequestView(changeRequests.byIdForUpdate(activityId, request.id()));
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public ChangeRequestView rejectChangeRequest(long activityId, long requestId, String reviewReason, AdminPrincipal admin,
                                               String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    String reason = requireReason(reviewReason);
    repository.lockPricing(activityId);
    IdempotencyResult replay = repository.beginIdempotency(activityId, "ADMIN", admin.id(), "ORDER_CHANGE_REJECT",
        idempotencyKey, hash(Map.of("requestId", requestId, "reason", reason)));
    if (replay.replay()) {
      OrderChangeRequestRow existing = changeRequests.byIdForUpdate(activityId, requestId);
      if (existing == null) throw DomainException.notFound("ORDER_CHANGE_REQUEST_NOT_FOUND", "订单变更申请不存在");
      return changeRequestView(existing);
    }
    OrderChangeRequestRow request = changeRequests.byIdForUpdate(activityId, requestId);
    if (request == null) throw DomainException.notFound("ORDER_CHANGE_REQUEST_NOT_FOUND", "订单变更申请不存在");
    if (!"PENDING".equals(request.status())) throw DomainException.conflict("ORDER_CHANGE_REQUEST_STATUS", "该申请已处理");
    OrderRow current = repository.lockOrderById(activityId, request.orderId());
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    repository.insertOperation(activityId, request.orderId(), "H5_CHANGE_REJECTED", "ADMIN", admin.id(), current.version(), reason, traceId);
    changeRequests.review(request.id(), "REJECTED", reason, admin.id());
    repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ORDER_CHANGE_REJECT", idempotencyKey, request.id());
    return changeRequestView(changeRequests.byIdForUpdate(activityId, request.id()));
  }

  public OrderPreview adminPreview(long activityId, AdminPreviewRequest request, AdminPrincipal admin) {
    requireAdminOrderWritable(activityId);
    CustomerSnapshot customer = repository.adminCustomer(activityId, request.activityCustomerId());
    return preview(calculate(activityId, customer, request.items()));
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public AdminOrderView adminCreate(long activityId, AdminCreateRequest request, AdminPrincipal admin,
                                    String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    repository.lockPricing(activityId);
    String reason = requireReason(request.reason());
    CustomerSnapshot customer = repository.adminCustomer(activityId, request.activityCustomerId());
    Map<Long, Long> quantities = quantities(request.items());
    IdempotencyResult replay = repository.beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_CREATE",
        idempotencyKey, hash(request));
    if (replay.replay()) {
      OrderView existing = repository.findByCustomer(activityId, customer.id());
      if (existing != null) return repository.adminView(existing);
      throw DomainException.conflict("REQUEST_REPLAY_RESULT_MISSING", "订单创建结果不存在，请刷新后重试");
    }
    OrderRow current = repository.lockOrder(activityId, customer.id());
    if (current != null) throw DomainException.conflict("ORDER_ALREADY_EXISTS", "该客户已经存在订单，请打开原订单进行调整");
    CalculatedOrder calculated = calculate(activityId, customer, quantities);
    long orderId = repository.insertAdminOrder(activityId, customer, calculated, admin.id());
    repository.insertCurrentItems(orderId, calculated.items());
    long versionId = repository.insertVersion(activityId, orderId, 1, customer, calculated.totalQuantity(), calculated.totalTons(),
        calculated.totalAmount(), "ADMIN", admin.id(), reason, idempotencyKey);
    repository.insertVersionItems(versionId, calculated.items());
    repository.insertOperation(activityId, orderId, "ADMIN_CREATE", "ADMIN", admin.id(), 1, reason, traceId);
    repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_CREATE", idempotencyKey, orderId);
    afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_CREATED", 1);
    return repository.adminOrder(activityId, orderId);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public AdminOrderView adminAdjust(long activityId, long orderId, AdminAdjustRequest request, AdminPrincipal admin,
                                    String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    repository.lockPricing(activityId);
    String reason = requireReason(request.reason());
    IdempotencyResult replay = repository.beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST",
        idempotencyKey, hash(Map.of("orderId", orderId, "request", request)));
    if (replay.replay()) return repository.adminOrder(activityId, orderId);
    OrderRow current = repository.lockOrderById(activityId, orderId);
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    if (current.version() != request.expectedVersion() || current.lockVersion() != request.expectedLockVersion()) {
      throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    }
    Map<Long, Long> quantities = quantities(request.items());
    if ("SUBMITTED".equals(current.status()) && repository.sameItems(orderId, quantities)) {
      CalculatedOrder repriced = calculate(activityId, repository.orderCustomer(activityId, current.customerId()), quantities);
      Map<Long, PricingResult> changedPrices = new LinkedHashMap<>();
      for (var item : repriced.items()) {
        var stored = repository.currentItem(orderId, item.product().id());
        var p = item.pricing();
        if (!samePriceValue(p.baseCasePrice(), stored.get("base_case_price") == null ? stored.get("case_price") : stored.get("base_case_price"))
            || !samePriceValue(p.tierCasePrice(), stored.get("tier_case_price"))
            || !samePriceValue(p.tierMinQuantity(), stored.get("tier_min_quantity"))
            || !java.util.Objects.equals(p.pricingMode(), stored.get("pricing_mode"))
            || !samePriceValue(p.lineAmount(), stored.get("line_amount"))) {
          changedPrices.put(item.product().id(), p);
        }
      }
      if (!changedPrices.isEmpty()) {
        repository.saveRepriced(activityId, orderId, changedPrices, admin.id(), "价格同步：" + reason, idempotencyKey);
        changeRequests.rejectPending(orderId, "订单已发生变化，本次申请失效，请重新提交");
        dashboards.refreshFinalSnapshots(activityId);
      }
      repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST", idempotencyKey, orderId);
      return repository.adminOrder(activityId, orderId);
    }
    CustomerSnapshot customer = repository.orderCustomer(activityId, current.customerId());
    CalculatedOrder calculated = calculate(activityId, customer, quantities);
    int nextVersion = current.version() + 1;
    int changed = repository.adjustOrder(activityId, orderId, current, nextVersion, calculated, admin.id());
    if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    repository.deleteCurrentItems(orderId);
    repository.insertCurrentItems(orderId, calculated.items());
    long versionId = repository.insertVersion(activityId, orderId, nextVersion, customer, calculated.totalQuantity(), calculated.totalTons(),
        calculated.totalAmount(), "ADMIN", admin.id(), reason, idempotencyKey);
    repository.insertVersionItems(versionId, calculated.items());
    String operation = "SUBMITTED".equals(current.status()) ? "ADMIN_ADJUST" : "ADMIN_RESTORE";
    repository.insertOperation(activityId, orderId, operation, "ADMIN", admin.id(), nextVersion, reason, traceId);
    repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST", idempotencyKey, orderId);
    afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_ADJUSTED", nextVersion);
    changeRequests.rejectPending(orderId, "订单已发生变化，本次申请失效，请重新提交");
    return repository.adminOrder(activityId, orderId);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public AdminOrderView adminVoid(long activityId, long orderId, AdminVoidRequest request, AdminPrincipal admin,
                                  String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    repository.lockPricing(activityId);
    String reason = requireReason(request.reason());
    IdempotencyResult replay = repository.beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_VOID",
        idempotencyKey, hash(Map.of("orderId", orderId, "request", request)));
    if (replay.replay()) return repository.adminOrder(activityId, orderId);
    OrderRow current = repository.lockOrderById(activityId, orderId);
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    if (current.version() != request.expectedVersion() || current.lockVersion() != request.expectedLockVersion()) {
      throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    }
    if (!"VOIDED".equals(current.status())) {
      int changed = repository.voidOrder(activityId, orderId, current, reason, admin.id());
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
      repository.insertOperation(activityId, orderId, "ADMIN_VOID", "ADMIN", admin.id(), current.version(), reason, traceId);
      afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_VOIDED", current.version());
      changeRequests.rejectPending(orderId, "订单已发生变化，本次申请失效，请重新提交");
    }
    repository.completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_VOID", idempotencyKey, orderId);
    return repository.adminOrder(activityId, orderId);
  }

  public PageResponse<OrderSummary> adminOrders(long activityId, String status, String customerType, String keyword,
                                                 int page, int size, String traceId) {
    return queries.adminOrders(activityId, status, customerType, keyword, page, size, traceId);
  }

  public byte[] export(long activityId, String status, String customerType, String keyword) {
    return exports.export(activityId, status, customerType, keyword);
  }


  private Map<Long, Long> quantities(List<SubmitItem> items) {
    if (items == null || items.isEmpty()) throw DomainException.unprocessable("ORDER_EMPTY", "请至少选择一种商品");
    if (items.size() > 1000) throw DomainException.unprocessable("ORDER_TOO_MANY_ITEMS", "订单商品种类过多");
    Map<Long, Long> quantities = new LinkedHashMap<>();
    for (SubmitItem item : items) {
      if (item.productId() <= 0 || item.quantity() <= 0 || item.quantity() > 999_999) {
        throw DomainException.unprocessable("ORDER_ITEM_INVALID", "商品和订货箱数必须有效");
      }
      if (quantities.put(item.productId(), item.quantity()) != null) {
        throw DomainException.unprocessable("ORDER_ITEM_DUPLICATE", "同一商品不能重复提交");
      }
    }
    return quantities;
  }

  private CalculatedOrder calculate(long activityId, CustomerSnapshot customer, List<SubmitItem> items) {
    return calculate(activityId, customer, quantities(items));
  }

  private CalculatedOrder calculate(long activityId, CustomerSnapshot customer, Map<Long, Long> quantities) {
    List<ProductSnapshot> products = repository.loadProducts(activityId, customer.id(), customer.customerType(), customer.branchName(), quantities.keySet());
    if (products.size() != quantities.size()) {
      throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "订单中包含不可订、已删除或不属于当前客户的商品");
    }
    List<CalculatedItem> items = new ArrayList<>();
    long totalQuantity = 0;
    BigDecimal totalAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal totalTons = BigDecimal.ZERO.setScale(6);
    boolean tonsAvailable = true;
    int line = 0;
    for (ProductSnapshot product : products) {
      long quantity = quantities.get(product.id());
      PricingResult pricing = calculatePrice(product.casePrice(), product.priceTierMinQuantity(),
          product.priceTierCasePrice(), product.priceTierPricingMode(), quantity);
       BigDecimal lineTons = calculateTons(quantity, product.tonCaseFactor());
      items.add(new CalculatedItem(++line, product, quantity, pricing, lineTons));
      totalQuantity += quantity;
      totalAmount = totalAmount.add(pricing.lineAmount());
      if (lineTons == null) tonsAvailable = false; else totalTons = totalTons.add(lineTons);
    }
    return new CalculatedOrder(items, totalQuantity, tonsAvailable ? totalTons : null, totalAmount);
  }

  private OrderPreview preview(CalculatedOrder calculated) {
    List<PreviewItem> items = calculated.items().stream().map(item -> new PreviewItem(
        item.product().id(), item.product().materialCode(), item.product().materialName(), item.product().productLine(),
        item.product().specification(), item.product().casePack(), item.quantity(), item.pricing().casePriceSnapshot(),
        item.pricing().appliedTierMinQuantity(), item.pricing().baseCasePrice(), item.pricing().baseQuantity(),
        item.pricing().tierCasePrice(), item.pricing().tierMinQuantity(), item.pricing().tierQuantity(),
        item.pricing().pricingMode(), item.pricing().lineAmount(), item.lineTons())).toList();
    return new OrderPreview(calculated.totalQuantity(), calculated.totalTons(), calculated.totalAmount(), items);
  }

  private ActivityService.ActivityView requireAdminOrderWritable(long activityId) {
    ActivityService.ActivityView activity = activities.byId(activityId);
    if (!List.of("ACTIVE", "CLOSED", "FINISHED", "ARCHIVED").contains(activity.status())) {
      throw DomainException.conflict("ADMIN_ORDER_ACTIVITY_NOT_READY", "活动开始后才可以维护正式订单");
    }
    return activity;
  }

  private static String requireReason(String reason) {
    if (reason == null || reason.trim().isEmpty()) throw DomainException.badRequest("ORDER_REASON_REQUIRED", "请填写操作原因");
    String value = reason.trim();
    if (value.length() > 500) throw DomainException.badRequest("ORDER_REASON_TOO_LONG", "操作原因不能超过 500 个字符");
    return value;
  }

  private static String optionalReason(String reason) {
    if (reason == null || reason.trim().isEmpty()) return null;
    String value = reason.trim();
    if (value.length() > 500) throw DomainException.badRequest("ORDER_REASON_TOO_LONG", "说明不能超过 500 个字符");
    return value;
  }

  private static String normalizeChangeRequestType(String type) {
    String value = type == null ? "" : type.trim().toUpperCase();
    if (!List.of("MODIFY", "WITHDRAW").contains(value)) throw DomainException.badRequest("ORDER_CHANGE_TYPE_INVALID", "订单变更类型不正确");
    return value;
  }

  private String writeChangeItems(List<CalculatedItem> items) {
    try {
      return json.writeValueAsString(items.stream().map(item -> new ChangeRequestItem(item.product().id(), item.product().materialCode(),
          item.product().materialName(), item.product().productLine(), item.quantity(), item.pricing().casePriceSnapshot(),
          item.pricing().lineAmount(), item.lineTons())).toList());
    } catch (Exception exception) {
      throw new IllegalStateException("订单变更申请快照保存失败", exception);
    }
  }

  private List<SubmitItem> requestItems(OrderChangeRequestRow request) {
    try {
      List<ChangeRequestItem> items = json.readValue(request.requestedItemsJson(), new TypeReference<>() {});
      return items.stream().map(item -> new SubmitItem(item.productId(), item.quantity())).toList();
    } catch (Exception exception) {
      throw new IllegalStateException("订单变更申请快照无法读取", exception);
    }
  }

  public ChangeRequestView changeRequestDetail(long activityId,long requestId) {
    var row=changeRequests.detail(activityId,requestId);
    if(row==null) throw DomainException.notFound("ORDER_CHANGE_REQUEST_NOT_FOUND","申请不存在");
    return changeRequestView(row);
  }

  private ChangeRequestView changeRequestView(OrderChangeRequestRow row) {
    if (row == null) return null;
    try {
      List<ChangeRequestItem> items = json.readValue(row.requestedItemsJson(), new TypeReference<>() {});
      return new ChangeRequestView(row.id(), row.orderId(), row.orderNo(), row.dealerName(), row.phoneMasked(), row.requestType(), row.status(),
          row.baseVersion(), row.currentVersion(), row.currentTotalQuantity(), row.currentTotalTons(), row.currentTotalAmount(),
          row.requestedTotalQuantity(), row.requestedTotalTons(), row.requestedTotalAmount(), items, row.customerNote(), row.reviewReason(),
          row.reviewedByName(), row.requestedAt(), row.reviewedAt(), row.originalOrderJson()==null?null:json.readValue(row.originalOrderJson(),OrderView.class));
    } catch (Exception exception) {
      throw new IllegalStateException("订单变更申请无法读取", exception);
    }
  }


  private void afterAdminOrderChange(ActivityService.ActivityView activity, long orderId, String event, int version) {
    if (!"ARCHIVED".equals(activity.status())) {
      repository.writeOutbox(activity.id(), orderId, event, Map.of("orderId", orderId, "version", version));
      dashboards.refreshFinalSnapshots(activity.id());
    }
  }


  // All order writers take this lock before reading catalog prices or locking orders.

  public AdminOrderView adminOrder(long activityId, long orderId) { return repository.adminOrder(activityId, orderId); }
  public List<OrderVersionView> versions(long activityId, long orderId) { return repository.versions(activityId, orderId); }
  public List<OperationView> operations(long activityId, long orderId) { return repository.operations(activityId, orderId); }
  private byte[] hash(Object value) {
    try { return MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(value)); }
    catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private static void requireIdentity(long activityId, H5Principal customer) { if (customer.activityId() != activityId) throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动"); }


  public record SubmitItem(long productId, long quantity) {}
  public record SubmitRequest(int expectedVersion, List<SubmitItem> items) {}
  public record WithdrawRequest(int expectedVersion) {}
  public record ChangeRequestRequest(int expectedVersion, String requestType, List<SubmitItem> items, String customerNote) {}
  public record ChangeRequestReviewRequest(String reason) {}
  public record AdminPreviewRequest(long activityCustomerId, List<SubmitItem> items) {}
  public record AdminCreateRequest(long activityCustomerId, List<SubmitItem> items, String reason) {}
  public record AdminAdjustRequest(int expectedVersion, int expectedLockVersion, List<SubmitItem> items, String reason) {}
  public record AdminVoidRequest(int expectedVersion, int expectedLockVersion, String reason) {}
  public record PreviewItem(long productId, String materialCode, String materialName, String productLine,
                            String specification, String casePack, long quantity, BigDecimal casePrice,
                            Long appliedTierMinQuantity, BigDecimal baseCasePrice, long basePriceQuantity,
                            BigDecimal tierCasePrice, Long tierMinQuantity, long tierPriceQuantity,
                            String pricingMode, BigDecimal lineAmount, BigDecimal lineTons) {}
  public record OrderPreview(long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, List<PreviewItem> items) {}
  public record ChangeRequestItem(long productId, String materialCode, String materialName, String productLine, long quantity,
                                  BigDecimal casePrice, BigDecimal lineAmount, BigDecimal lineTons) {}
  public record ChangeRequestView(long id, long orderId, String orderNo, String dealerName, String phoneMasked, String requestType,
                                  String status, int baseVersion, int currentVersion, long currentTotalQuantity, BigDecimal currentTotalTons,
                                  BigDecimal currentTotalAmount, Long requestedTotalQuantity, BigDecimal requestedTotalTons,
                                  BigDecimal requestedTotalAmount, List<ChangeRequestItem> items, String customerNote, String reviewReason,
                                  String reviewedByName, Instant requestedAt, Instant reviewedAt, OrderView originalOrder) {}
  public record ItemView(long id, Long productId, int lineNo, String materialCode, String materialName, String productLine, String specification, String casePack, long quantity, BigDecimal casePrice, Long appliedTierMinQuantity, BigDecimal baseCasePrice, Long basePriceQuantity, BigDecimal tierCasePrice, Long tierMinQuantity, Long tierPriceQuantity, String pricingMode, BigDecimal lineAmount, BigDecimal tonCaseFactor, BigDecimal lineTons) {}
  public record OrderVersionView(long id, int version, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount,
                                 Instant submittedAt, String submittedSource, String submittedByAdminName,
                                 String reason, List<ItemView> items) {}
  public record OperationView(String type, String source, String adminName, Integer orderVersion, String reason,
                              Instant occurredAt) {}
  public record OrderSummary(long id, String orderNo, String status, String createdSource, String lastModifiedSource,
                             String customerType, String regionCode, String branchName, String dealerFullName,
                             String phone, String phoneMasked, int currentVersion, int lockVersion, long totalQuantity,
                             BigDecimal totalTons, BigDecimal totalAmount, Instant firstSubmittedAt,
                             Instant lastSubmittedAt, Instant lastModifiedAt) {}
  public record AdminOrderView(long id, long activityId, long activityCustomerId, String orderNo, String status,
                               String createdSource, String lastModifiedSource, int lockVersion, String customerType,
                               String regionCode, String branchName, String dealerShortName, String dealerFullName,
                               String phone, String phoneMasked, int currentVersion, long totalQuantity, BigDecimal totalTons,
                               BigDecimal totalAmount, Instant firstSubmittedAt, Instant lastSubmittedAt, Instant lastModifiedAt,
                               Instant withdrawnAt, String withdrawnReason, Instant voidedAt, String voidedReason,
                               List<ItemView> items, List<OrderVersionView> versions, List<OperationView> operations) {}
  public record OrderView(long id, long activityId, long activityCustomerId, String orderNo, String status,
                          String createdSource, String lastModifiedSource, int lockVersion, String customerType,
                          String regionCode, String branchName, String dealerShortName, String dealerFullName,
                          String phoneMasked, int currentVersion, long totalQuantity, BigDecimal totalTons,
                          BigDecimal totalAmount, Instant firstSubmittedAt, Instant lastSubmittedAt,
                          Instant lastModifiedAt, Instant withdrawnAt, String withdrawnReason, Instant voidedAt,
                          String voidedReason, List<ItemView> items, List<OrderVersionView> versions,
                          List<OperationView> operations) {}
}
