package com.fengyi.ordershow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.CryptoService;
import com.fengyi.ordershow.security.H5Principal;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final DashboardService dashboards;
  private final ObjectMapper json;
  private final CryptoService crypto;

  public OrderService(JdbcTemplate jdbc, ActivityService activities, DashboardService dashboards, ObjectMapper json,
                      CryptoService crypto) {
    this.jdbc = jdbc;
    this.activities = activities;
    this.dashboards = dashboards;
    this.json = json;
    this.crypto = crypto;
  }

  public OrderView current(String activityCode, H5Principal customer) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    return findByCustomer(activity.id(), customer.customerId());
  }

  @Transactional
  public OrderView submit(String activityCode, H5Principal customer, SubmitRequest request, String idempotencyKey, String traceId) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    activities.requireWritable(activity.id());
    if (request.items() == null || request.items().isEmpty()) throw DomainException.unprocessable("ORDER_EMPTY", "请至少选择一种商品");
    if (request.items().size() > 1000) throw DomainException.unprocessable("ORDER_TOO_MANY_ITEMS", "订单商品种类过多");
    Map<Long, Long> quantities = new LinkedHashMap<>();
    for (SubmitItem item : request.items()) {
      if (item.productId() <= 0 || item.quantity() <= 0 || item.quantity() > 999_999) throw DomainException.unprocessable("ORDER_ITEM_INVALID", "商品和订货箱数必须有效");
      if (quantities.put(item.productId(), item.quantity()) != null) throw DomainException.unprocessable("ORDER_ITEM_DUPLICATE", "同一商品不能重复提交");
    }
    byte[] requestHash = hash(request);
    IdempotencyResult replay = beginIdempotency(activity.id(), customer.customerId(), "ORDER_SUBMIT", idempotencyKey, requestHash);
    if (replay.replay()) {
      deleteDraft(activity.id(), customer.customerId());
      return findByCustomer(activity.id(), customer.customerId());
    }

    OrderRow current = lockOrder(activity.id(), customer.customerId());
    int currentVersion = current == null ? 0 : current.version();
    if (request.expectedVersion() != currentVersion) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已在其他页面更新，请刷新后重试");
    if (current != null && "VOIDED".equals(current.status())) {
      throw DomainException.conflict("ORDER_VOIDED", "订单已由管理员作废，请联系管理员处理");
    }
    if (current != null && "SUBMITTED".equals(current.status()) && sameItems(current.id(), quantities)) {
      completeIdempotency(activity.id(), customer.customerId(), "ORDER_SUBMIT", idempotencyKey, current.id());
      deleteDraft(activity.id(), customer.customerId());
      return order(current.id());
    }

    List<ProductSnapshot> products = loadProducts(activity.id(), customer.customerType(), customer.branchName(), quantities.keySet());
    if (products.size() != quantities.size()) throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "订单中包含不可订、已删除或不属于当前客户的商品");
    List<CalculatedItem> items = new ArrayList<>();
    long totalQuantity = 0;
    BigDecimal totalAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal totalTons = BigDecimal.ZERO.setScale(6);
    boolean tonsAvailable = true;
    int line = 0;
    for (ProductSnapshot product : products) {
      long quantity = quantities.get(product.id());
      PricingResult pricing = calculatePrice(product.casePrice(), product.priceTierMinQuantity(), product.priceTierCasePrice(), product.priceTierPricingMode(), quantity);
      BigDecimal lineTons = product.tonCaseFactor() == null ? null : BigDecimal.valueOf(quantity).divide(product.tonCaseFactor(), 6, RoundingMode.HALF_UP);
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
      String orderNo = orderNo(activity.id());
      GeneratedKeyHolder keys = new GeneratedKeyHolder();
      BigDecimal finalTotalTons = totalTons;
      long finalTotalQuantity = totalQuantity;
      BigDecimal finalTotalAmount = totalAmount;
      jdbc.update(connection -> {
        var ps = connection.prepareStatement("""
            INSERT INTO customer_order(activity_id, activity_customer_id, order_no, status, customer_type, region_code,
              branch_name_snapshot, dealer_short_name_snapshot, dealer_full_name_snapshot, current_version_no,
              total_quantity, total_tons, total_amount, first_submitted_at, last_submitted_at, last_modified_at, last_modified_source)
            VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, 1, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 'H5')
            """, Statement.RETURN_GENERATED_KEYS);
        int i = 0; ps.setLong(++i, activity.id()); ps.setLong(++i, customer.customerId()); ps.setString(++i, orderNo);
        ps.setString(++i, customer.customerType()); ps.setString(++i, customer.regionCode()); ps.setString(++i, customer.branchName());
        ps.setString(++i, customer.dealerShortName()); ps.setString(++i, customer.dealerFullName()); ps.setLong(++i, finalTotalQuantity);
        ps.setBigDecimal(++i, finalTotalTons); ps.setBigDecimal(++i, finalTotalAmount); return ps;
      }, keys);
      orderId = keys.getKey().longValue();
    } else {
      int changed = jdbc.update("""
          UPDATE customer_order SET status = 'SUBMITTED', current_version_no = ?, total_quantity = ?, total_tons = ?,
            total_amount = ?, last_submitted_at = UTC_TIMESTAMP(3), last_modified_at = UTC_TIMESTAMP(3), withdrawn_at = NULL,
            withdrawn_reason = NULL, last_modified_source = 'H5', lock_version = lock_version + 1
          WHERE id = ? AND current_version_no = ? AND lock_version = ?
          """, nextVersion, totalQuantity, totalTons, totalAmount, current.id(), currentVersion, current.lockVersion());
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已在其他页面更新，请刷新后重试");
      orderId = current.id();
      jdbc.update("DELETE FROM order_item WHERE order_id = ?", orderId);
    }
    insertCurrentItems(orderId, items);
    long versionId = insertVersion(activity.id(), orderId, nextVersion, customer, totalQuantity, totalTons, totalAmount, idempotencyKey);
    insertVersionItems(versionId, items);
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, order_version_no, trace_id, occurred_at)
        VALUES (?, ?, ?, 'H5', ?, ?, UTC_TIMESTAMP(3))
        """, activity.id(), orderId, first ? "FIRST_SUBMIT" : resubmit ? "RESUBMIT" : "MODIFY_SUBMIT", nextVersion, traceId);
    writeOutbox(activity.id(), orderId, "ORDER_SUBMITTED", Map.of("orderId", orderId, "version", nextVersion));
    completeIdempotency(activity.id(), customer.customerId(), "ORDER_SUBMIT", idempotencyKey, orderId);
    deleteDraft(activity.id(), customer.customerId());
    return order(orderId);
  }

  @Transactional
  public OrderView withdraw(String activityCode, H5Principal customer, int expectedVersion, String idempotencyKey, String traceId) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    activities.requireWritable(activity.id());
    byte[] requestHash = hash(Map.of("expectedVersion", expectedVersion));
    IdempotencyResult replay = beginIdempotency(activity.id(), customer.customerId(), "ORDER_WITHDRAW", idempotencyKey, requestHash);
    if (replay.replay()) {
      deleteDraft(activity.id(), customer.customerId());
      return findByCustomer(activity.id(), customer.customerId());
    }
    OrderRow order = lockOrder(activity.id(), customer.customerId());
    if (order == null) throw DomainException.notFound("ORDER_NOT_FOUND", "尚未提交订单");
    if (order.version() != expectedVersion) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单版本已变化，请刷新后重试");
    if ("WITHDRAWN".equals(order.status())) {
      completeIdempotency(activity.id(), customer.customerId(), "ORDER_WITHDRAW", idempotencyKey, order.id());
      deleteDraft(activity.id(), customer.customerId());
      return order(order.id());
    }
    int changed = jdbc.update("""
        UPDATE customer_order SET status = 'WITHDRAWN', withdrawn_at = UTC_TIMESTAMP(3), withdrawn_reason = '客户主动撤回',
          last_modified_at = UTC_TIMESTAMP(3), last_modified_source = 'H5', lock_version = lock_version + 1
        WHERE id = ? AND status = 'SUBMITTED' AND current_version_no = ? AND lock_version = ?
        """, order.id(), expectedVersion, order.lockVersion());
    if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单状态已变化，请刷新后重试");
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, order_version_no, reason, trace_id, occurred_at)
        VALUES (?, ?, 'WITHDRAW', 'H5', ?, '客户主动撤回', ?, UTC_TIMESTAMP(3))
        """, activity.id(), order.id(), expectedVersion, traceId);
    writeOutbox(activity.id(), order.id(), "ORDER_WITHDRAWN", Map.of("orderId", order.id(), "version", expectedVersion));
    completeIdempotency(activity.id(), customer.customerId(), "ORDER_WITHDRAW", idempotencyKey, order.id());
    deleteDraft(activity.id(), customer.customerId());
    return order(order.id());
  }

  public OrderPreview adminPreview(long activityId, AdminPreviewRequest request, AdminPrincipal admin) {
    requireAdminOrderWritable(activityId);
    CustomerSnapshot customer = adminCustomer(activityId, request.activityCustomerId());
    return preview(calculate(activityId, customer, request.items()));
  }

  @Transactional
  public AdminOrderView adminCreate(long activityId, AdminCreateRequest request, AdminPrincipal admin,
                                    String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    String reason = requireReason(request.reason());
    CustomerSnapshot customer = adminCustomer(activityId, request.activityCustomerId());
    Map<Long, Long> quantities = quantities(request.items());
    IdempotencyResult replay = beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_CREATE",
        idempotencyKey, hash(request));
    if (replay.replay()) {
      OrderView existing = findByCustomer(activityId, customer.id());
      if (existing != null) return adminView(existing);
      throw DomainException.conflict("REQUEST_REPLAY_RESULT_MISSING", "订单创建结果不存在，请刷新后重试");
    }
    OrderRow current = lockOrder(activityId, customer.id());
    if (current != null) throw DomainException.conflict("ORDER_ALREADY_EXISTS", "该客户已经存在订单，请打开原订单进行调整");
    CalculatedOrder calculated = calculate(activityId, customer, quantities);
    long orderId = insertAdminOrder(activityId, customer, calculated, admin.id());
    insertCurrentItems(orderId, calculated.items());
    long versionId = insertVersion(activityId, orderId, 1, customer, calculated.totalQuantity(), calculated.totalTons(),
        calculated.totalAmount(), "ADMIN", admin.id(), reason, idempotencyKey);
    insertVersionItems(versionId, calculated.items());
    insertOperation(activityId, orderId, "ADMIN_CREATE", "ADMIN", admin.id(), 1, reason, traceId);
    completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_CREATE", idempotencyKey, orderId);
    afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_CREATED", 1);
    return adminOrder(activityId, orderId);
  }

  @Transactional
  public AdminOrderView adminAdjust(long activityId, long orderId, AdminAdjustRequest request, AdminPrincipal admin,
                                    String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    String reason = requireReason(request.reason());
    IdempotencyResult replay = beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST",
        idempotencyKey, hash(Map.of("orderId", orderId, "request", request)));
    if (replay.replay()) return adminOrder(activityId, orderId);
    OrderRow current = lockOrderById(activityId, orderId);
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    if (current.version() != request.expectedVersion() || current.lockVersion() != request.expectedLockVersion()) {
      throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    }
    Map<Long, Long> quantities = quantities(request.items());
    if ("SUBMITTED".equals(current.status()) && sameItems(orderId, quantities)) {
      completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST", idempotencyKey, orderId);
      return adminOrder(activityId, orderId);
    }
    CustomerSnapshot customer = orderCustomer(activityId, current.customerId());
    CalculatedOrder calculated = calculate(activityId, customer, quantities);
    int nextVersion = current.version() + 1;
    int changed = jdbc.update("""
        UPDATE customer_order SET status = 'SUBMITTED', current_version_no = ?, total_quantity = ?, total_tons = ?,
          total_amount = ?, last_modified_at = UTC_TIMESTAMP(3), withdrawn_at = NULL, withdrawn_reason = NULL,
          voided_at = NULL, voided_reason = NULL, voided_by_admin_id = NULL,
          last_modified_source = 'ADMIN', last_modified_admin_id = ?, lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND current_version_no = ? AND lock_version = ?
        """, nextVersion, calculated.totalQuantity(), calculated.totalTons(), calculated.totalAmount(), admin.id(),
        orderId, activityId, current.version(), current.lockVersion());
    if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    jdbc.update("DELETE FROM order_item WHERE order_id = ?", orderId);
    insertCurrentItems(orderId, calculated.items());
    long versionId = insertVersion(activityId, orderId, nextVersion, customer, calculated.totalQuantity(), calculated.totalTons(),
        calculated.totalAmount(), "ADMIN", admin.id(), reason, idempotencyKey);
    insertVersionItems(versionId, calculated.items());
    String operation = "SUBMITTED".equals(current.status()) ? "ADMIN_ADJUST" : "ADMIN_RESTORE";
    insertOperation(activityId, orderId, operation, "ADMIN", admin.id(), nextVersion, reason, traceId);
    completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_ADJUST", idempotencyKey, orderId);
    afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_ADJUSTED", nextVersion);
    return adminOrder(activityId, orderId);
  }

  @Transactional
  public AdminOrderView adminVoid(long activityId, long orderId, AdminVoidRequest request, AdminPrincipal admin,
                                  String idempotencyKey, String traceId) {
    ActivityService.ActivityView activity = requireAdminOrderWritable(activityId);
    String reason = requireReason(request.reason());
    IdempotencyResult replay = beginIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_VOID",
        idempotencyKey, hash(Map.of("orderId", orderId, "request", request)));
    if (replay.replay()) return adminOrder(activityId, orderId);
    OrderRow current = lockOrderById(activityId, orderId);
    if (current == null) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    if (current.version() != request.expectedVersion() || current.lockVersion() != request.expectedLockVersion()) {
      throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
    }
    if (!"VOIDED".equals(current.status())) {
      int changed = jdbc.update("""
          UPDATE customer_order SET status = 'VOIDED', voided_at = UTC_TIMESTAMP(3), voided_reason = ?,
            voided_by_admin_id = ?, last_modified_at = UTC_TIMESTAMP(3), last_modified_source = 'ADMIN',
            last_modified_admin_id = ?, lock_version = lock_version + 1
          WHERE id = ? AND activity_id = ? AND current_version_no = ? AND lock_version = ?
          """, reason, admin.id(), admin.id(), orderId, activityId, current.version(), current.lockVersion());
      if (changed != 1) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已被其他操作更新，请刷新后重试");
      insertOperation(activityId, orderId, "ADMIN_VOID", "ADMIN", admin.id(), current.version(), reason, traceId);
      afterAdminOrderChange(activity, orderId, "ORDER_ADMIN_VOIDED", current.version());
    }
    completeIdempotency(activityId, "ADMIN", admin.id(), "ADMIN_ORDER_VOID", idempotencyKey, orderId);
    return adminOrder(activityId, orderId);
  }

  public PageResponse<OrderSummary> adminOrders(long activityId, String status, String customerType, String keyword,
                                                 int page, int size, String traceId) {
    int safePage = Math.max(page, 1), safeSize = Math.min(Math.max(size, 1), 200), offset = (safePage - 1) * safeSize;
    String where = orderFilterSql();
    Object[] args = orderFilterArgs(activityId, status, customerType, keyword);
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where, Long.class, args);
    List<Object> pagedArgs = new ArrayList<>(java.util.Arrays.asList(args)); pagedArgs.add(safeSize); pagedArgs.add(offset);
    List<OrderSummary> data = jdbc.query("""
        SELECT o.*, c.phone, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC LIMIT ? OFFSET ?", this::mapSummary, pagedArgs.toArray());
    return PageResponse.of(data, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  public AdminOrderView adminOrder(long activityId, long orderId) {
    OrderView order = order(orderId);
    if (order.activityId() != activityId) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    return adminView(order);
  }

  public List<OrderVersionView> versions(long activityId, long orderId) {
    adminOrder(activityId, orderId);
    return jdbc.query("""
        SELECT v.*, u.display_name submitted_by_admin_name FROM order_version v
        LEFT JOIN admin_user u ON u.id = v.submitted_by_admin_id
        WHERE v.order_id = ? ORDER BY v.version_no DESC
        """, this::mapVersion, orderId)
        .stream().map(this::withVersionItems).toList();
  }

  public List<OperationView> operations(long activityId, long orderId) {
    adminOrder(activityId, orderId);
    return jdbc.query("""
        SELECT o.operation_type, o.source, u.display_name admin_name, o.order_version_no, o.reason, o.occurred_at
        FROM order_operation o LEFT JOIN admin_user u ON u.id = o.admin_user_id
        WHERE o.order_id = ? ORDER BY o.occurred_at DESC, o.id DESC
        """, this::mapOperation, orderId);
  }

  public byte[] export(long activityId, String status, String customerType, String keyword) {
    String where = orderFilterSql();
    Object[] args = orderFilterArgs(activityId, status, customerType, keyword);
    List<OrderSummary> orders = jdbc.query("SELECT o.*, c.phone, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where + " ORDER BY o.last_modified_at DESC, o.id DESC", this::mapSummary, args);
    List<Map<String, Object>> details = jdbc.queryForList("""
        SELECT o.order_no, o.status, o.created_source, o.customer_type, o.region_code, o.branch_name_snapshot,
          o.dealer_full_name_snapshot, c.phone, c.phone_masked, o.current_version_no, i.line_no, i.material_code,
          i.material_name, i.product_line, i.specification, i.case_pack, i.quantity, i.case_price, i.applied_tier_min_quantity,
          i.base_case_price, i.base_price_quantity, i.tier_case_price, i.tier_min_quantity, i.tier_price_quantity, i.pricing_mode,
          i.line_amount, i.line_tons, o.last_submitted_at
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        JOIN order_item i ON i.order_id = o.id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC, i.line_no", args);
    String effectiveWhere = where;
    Object[] effectiveArgs = orderFilterArgs(activityId, "SUBMITTED", customerType, keyword);
    List<Map<String, Object>> productTotals = jdbc.queryForList("""
        SELECT i.material_code, i.material_name, i.product_line, i.specification, i.case_pack,
          SUM(i.quantity) total_quantity, SUM(i.line_amount) total_amount,
          CASE WHEN COUNT(i.line_tons) = COUNT(*) THEN SUM(i.line_tons) ELSE NULL END total_tons,
          COUNT(DISTINCT o.id) order_count
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        JOIN order_item i ON i.order_id = o.id
        """ + effectiveWhere + " GROUP BY i.material_code, i.material_name, i.product_line, i.specification, i.case_pack ORDER BY i.product_line, i.material_code", effectiveArgs);
    List<Map<String, Object>> branchTotals = jdbc.queryForList("""
        SELECT o.region_code, o.branch_name_snapshot, COUNT(*) order_count, SUM(o.total_quantity) total_quantity,
          CASE WHEN COUNT(o.total_tons) = COUNT(*) THEN SUM(o.total_tons) ELSE NULL END total_tons,
          SUM(o.total_amount) total_amount
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        """ + effectiveWhere + " GROUP BY o.region_code, o.branch_name_snapshot ORDER BY o.region_code, o.branch_name_snapshot", effectiveArgs);
    try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("订单汇总");
      String[] headers = {"订单编号", "状态", "来源", "客户类型", "大区", "分公司", "经销商", "电话", "版本", "订货箱数", "订货吨数", "订单金额", "首次提交", "最后提交", "最后修改"};
      Row header = sheet.createRow(0); for (int i = 0; i < headers.length; i++) header.createCell(i).setCellValue(headers[i]);
      int rowNo = 1;
      for (OrderSummary order : orders) {
        Row row = sheet.createRow(rowNo++); int i = 0;
        Object[] values = {order.orderNo(), order.status(), sourceLabel(order.createdSource()), order.customerType(), order.regionCode(), order.branchName(), order.dealerFullName(),
            order.phone(), order.currentVersion(), order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(), order.lastModifiedAt()};
        for (Object value : values) row.createCell(i++).setCellValue(value == null ? "" : value.toString());
      }
      for (int i = 0; i < headers.length; i++) sheet.autoSizeColumn(i);
      Sheet detailSheet = workbook.createSheet("订单商品明细");
      String[] detailHeaders = {"订单编号", "状态", "来源", "客户类型", "大区", "分公司", "经销商", "电话", "订单版本", "行号", "物料代码", "物料名称", "产品线", "规格", "箱规", "订货箱数", "计价模式", "基础箱价", "基础价箱数", "阶梯箱价", "阶梯箱数", "阶梯起订箱数", "是否命中阶梯", "金额", "吨数", "最后提交"};
      writeHeaders(detailSheet, detailHeaders);
      int detailRowNo = 1;
      for (Map<String, Object> item : details) {
        writeValues(detailSheet.createRow(detailRowNo++), item.get("order_no"), item.get("status"), sourceLabel(item.get("created_source")), item.get("customer_type"),
            item.get("region_code"), item.get("branch_name_snapshot"), item.get("dealer_full_name_snapshot"),
            item.get("phone"),
            item.get("current_version_no"), item.get("line_no"), item.get("material_code"), item.get("material_name"), item.get("product_line"),
            item.get("specification"), item.get("case_pack"), item.get("quantity"), item.get("pricing_mode"), item.get("base_case_price"),
            item.get("base_price_quantity"), item.get("tier_case_price"), item.get("tier_price_quantity"), item.get("tier_min_quantity"),
            item.get("applied_tier_min_quantity") == null ? "否" : "是", item.get("line_amount"),
            item.get("line_tons"), item.get("last_submitted_at"));
      }
      Sheet productSheet = workbook.createSheet("有效商品汇总");
      writeHeaders(productSheet, new String[]{"物料代码", "物料名称", "产品线", "规格", "箱规", "订货箱数", "订货金额", "订货吨数", "下单客户数"});
      int productRowNo = 1;
      for (Map<String, Object> item : productTotals) writeValues(productSheet.createRow(productRowNo++), item.get("material_code"), item.get("material_name"),
          item.get("product_line"), item.get("specification"), item.get("case_pack"), item.get("total_quantity"), item.get("total_amount"),
          item.get("total_tons"), item.get("order_count"));
      Sheet branchSheet = workbook.createSheet("有效分公司汇总");
      writeHeaders(branchSheet, new String[]{"大区", "分公司", "有效订单数", "订货箱数", "订货吨数", "订单金额"});
      int branchRowNo = 1;
      for (Map<String, Object> item : branchTotals) writeValues(branchSheet.createRow(branchRowNo++), item.get("region_code"), item.get("branch_name_snapshot"),
          item.get("order_count"), item.get("total_quantity"), item.get("total_tons"), item.get("total_amount"));
      workbook.write(output); return output.toByteArray();
    } catch (Exception exception) { throw new IllegalStateException("订单导出失败", exception); }
  }

  private static void writeHeaders(Sheet sheet, String[] headers) {
    Row row = sheet.createRow(0);
    for (int i = 0; i < headers.length; i++) row.createCell(i).setCellValue(headers[i]);
    sheet.createFreezePane(0, 1);
  }

  private static void writeValues(Row row, Object... values) {
    for (int i = 0; i < values.length; i++) row.createCell(i).setCellValue(values[i] == null ? "" : values[i].toString());
  }

  private static String sourceLabel(Object source) {
    return "ADMIN".equals(source == null ? null : source.toString()) ? "管理员" : "客户";
  }

  private static String orderFilterSql() {
    return " WHERE o.activity_id = ? AND (? IS NULL OR ? = '' OR o.status = ?) AND (? IS NULL OR ? = '' OR o.customer_type = ?) " +
        "AND (? IS NULL OR ? = '' OR o.order_no LIKE CONCAT('%', ?, '%') OR o.dealer_full_name_snapshot LIKE CONCAT('%', ?, '%') " +
        "OR c.phone LIKE CONCAT('%', ?, '%') OR c.phone_lookup_hash = ? OR c.phone_masked LIKE CONCAT('%', ?, '%'))";
  }

  private Object[] orderFilterArgs(long activityId, String status, String customerType, String keyword) {
    String normalizedKeyword = keyword == null ? null : keyword.trim();
    String digits = CryptoService.normalizePhone(normalizedKeyword);
    byte[] phoneHash = digits.length() == 11 ? crypto.lookupHash(digits) : null;
    String phoneSuffix = digits.length() >= 4 ? digits.substring(digits.length() - 4) : null;
    return new Object[]{activityId, status, status, status, customerType, customerType, customerType,
        normalizedKeyword, normalizedKeyword, normalizedKeyword, normalizedKeyword, digits.isEmpty() ? normalizedKeyword : digits, phoneHash, phoneSuffix};
  }

  private List<ProductSnapshot> loadProducts(long activityId, String customerType, String branchName, Set<Long> ids) {
    if (ids.isEmpty()) return List.of();
    String placeholders = ids.stream().map(id -> "?").collect(Collectors.joining(","));
    List<Object> args = new ArrayList<>(); args.add(activityId); args.add(customerType); args.add(customerType); args.add(normalize(branchName)); args.addAll(ids);
    return jdbc.query("""
        SELECT p.*, (SELECT sf.object_key FROM product_image pi JOIN stored_file sf ON sf.id = pi.stored_file_id
          WHERE pi.activity_product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.is_primary DESC, pi.sort_no, pi.id LIMIT 1) image_key
          , (SELECT t.min_quantity FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_min_quantity
          , (SELECT t.case_price FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_case_price
          , (SELECT t.pricing_mode FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_pricing_mode
        FROM activity_product p JOIN activity_data_binding b ON b.current_version_id = p.data_version_id AND b.activity_id = p.activity_id AND b.data_type = 'PRODUCT'
        WHERE p.activity_id = ? AND (? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL') AND p.is_visible = TRUE AND p.is_orderable = TRUE
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
          AND p.id IN (""" + placeholders + ") ORDER BY p.sort_no, p.id", this::mapProduct, args.toArray());
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
    List<ProductSnapshot> products = loadProducts(activityId, customer.customerType(), customer.branchName(), quantities.keySet());
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
      BigDecimal lineTons = product.tonCaseFactor() == null ? null
          : BigDecimal.valueOf(quantity).divide(product.tonCaseFactor(), 6, RoundingMode.HALF_UP);
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

  private CustomerSnapshot adminCustomer(long activityId, long activityCustomerId) {
    List<CustomerSnapshot> rows = jdbc.query("""
        SELECT c.id, c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name
        FROM activity_customer c
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE c.id = ? AND c.activity_id = ? AND c.is_active = TRUE
          AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
        """, (rs, rowNum) -> new CustomerSnapshot(rs.getLong("id"), rs.getString("customer_type"),
        rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"),
        rs.getString("dealer_full_name")), activityCustomerId, activityId);
    if (rows.size() != 1) throw DomainException.notFound("CUSTOMER_NOT_FOUND", "当前活动客户不存在或已失效");
    return rows.getFirst();
  }

  private CustomerSnapshot orderCustomer(long activityId, long activityCustomerId) {
    List<CustomerSnapshot> rows = jdbc.query("""
        SELECT id, customer_type, region_code, branch_name, dealer_short_name, dealer_full_name
        FROM activity_customer WHERE id = ? AND activity_id = ?
        """, (rs, rowNum) -> new CustomerSnapshot(rs.getLong("id"), rs.getString("customer_type"),
        rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"),
        rs.getString("dealer_full_name")), activityCustomerId, activityId);
    if (rows.size() != 1) throw DomainException.notFound("CUSTOMER_NOT_FOUND", "订单关联客户不存在");
    return rows.getFirst();
  }

  private long insertAdminOrder(long activityId, CustomerSnapshot customer, CalculatedOrder calculated, long adminId) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var ps = connection.prepareStatement("""
          INSERT INTO customer_order(activity_id, activity_customer_id, order_no, status, customer_type, region_code,
            branch_name_snapshot, dealer_short_name_snapshot, dealer_full_name_snapshot, created_source,
            created_by_admin_id, current_version_no, total_quantity, total_tons, total_amount, first_submitted_at,
            last_submitted_at, last_modified_at, last_modified_source, last_modified_admin_id)
          VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, 'ADMIN', ?, 1, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3),
            UTC_TIMESTAMP(3), 'ADMIN', ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int i = 0;
      ps.setLong(++i, activityId); ps.setLong(++i, customer.id()); ps.setString(++i, orderNo(activityId));
      ps.setString(++i, customer.customerType()); ps.setString(++i, customer.regionCode());
      ps.setString(++i, customer.branchName()); ps.setString(++i, customer.dealerShortName());
      ps.setString(++i, customer.dealerFullName()); ps.setLong(++i, adminId);
      ps.setLong(++i, calculated.totalQuantity()); ps.setBigDecimal(++i, calculated.totalTons());
      ps.setBigDecimal(++i, calculated.totalAmount()); ps.setLong(++i, adminId);
      return ps;
    }, keys);
    return keys.getKey().longValue();
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

  private void insertOperation(long activityId, long orderId, String operation, String source, Long adminId,
                               Integer version, String reason, String traceId) {
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, admin_user_id,
          order_version_no, reason, trace_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        """, activityId, orderId, operation, source, adminId, version, reason, traceId);
  }

  private void afterAdminOrderChange(ActivityService.ActivityView activity, long orderId, String event, int version) {
    if (!"ARCHIVED".equals(activity.status())) {
      writeOutbox(activity.id(), orderId, event, Map.of("orderId", orderId, "version", version));
      dashboards.refreshFinalSnapshots(activity.id());
    }
  }

  private boolean sameItems(long orderId, Map<Long, Long> expected) {
    Map<Long, Long> current = jdbc.query("SELECT activity_product_id, quantity FROM order_item WHERE order_id = ?",
        rs -> { Map<Long, Long> map = new HashMap<>(); while (rs.next()) map.put(rs.getLong(1), rs.getLong(2)); return map; }, orderId);
    return current.equals(expected);
  }

  private void insertCurrentItems(long orderId, List<CalculatedItem> items) {
    for (CalculatedItem item : items) jdbc.update("""
        INSERT INTO order_item(order_id, activity_product_id, line_no, material_code, material_name, category_name,
          product_line, brand_name, variety_name, specification, case_pack, rebate_status, is_gift_box,
          primary_image_object_key, quantity, case_price, applied_tier_min_quantity, base_case_price, base_price_quantity,
          tier_case_price, tier_min_quantity, tier_price_quantity, pricing_mode, line_amount, ton_case_factor, line_tons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, orderId, item.product().id(), item.lineNo(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().rebateStatus(), item.product().giftBox(),
        item.product().imageKey(), item.quantity(), item.pricing().casePriceSnapshot(), item.pricing().appliedTierMinQuantity(),
        item.pricing().baseCasePrice(), item.pricing().baseQuantity(), item.pricing().tierCasePrice(), item.pricing().tierMinQuantity(), item.pricing().tierQuantity(),
        item.pricing().pricingMode(), item.pricing().lineAmount(), item.product().tonCaseFactor(), item.lineTons());
  }

  private long insertVersion(long activityId, long orderId, int version, H5Principal customer, long totalQuantity,
                             BigDecimal totalTons, BigDecimal totalAmount, String idempotencyKey) {
    return insertVersion(activityId, orderId, version,
        new CustomerSnapshot(customer.customerId(), customer.customerType(), customer.regionCode(), customer.branchName(),
            customer.dealerShortName(), customer.dealerFullName()),
        totalQuantity, totalTons, totalAmount, "H5", null, null, idempotencyKey);
  }

  private long insertVersion(long activityId, long orderId, int version, CustomerSnapshot customer, long totalQuantity,
                             BigDecimal totalTons, BigDecimal totalAmount, String source, Long adminId,
                             String reason, String idempotencyKey) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var ps = connection.prepareStatement("""
          INSERT INTO order_version(activity_id, order_id, version_no, customer_type, region_code, branch_name_snapshot,
            dealer_short_name_snapshot, dealer_full_name_snapshot, total_quantity, total_tons, total_amount,
            submitted_source, submitted_by_admin_id, reason, submitted_at, request_idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int i = 0; ps.setLong(++i, activityId); ps.setLong(++i, orderId); ps.setInt(++i, version); ps.setString(++i, customer.customerType());
      ps.setString(++i, customer.regionCode()); ps.setString(++i, customer.branchName()); ps.setString(++i, customer.dealerShortName());
      ps.setString(++i, customer.dealerFullName()); ps.setLong(++i, totalQuantity); ps.setBigDecimal(++i, totalTons);
      ps.setBigDecimal(++i, totalAmount); ps.setString(++i, source); ps.setObject(++i, adminId); ps.setString(++i, reason);
      ps.setString(++i, idempotencyKey); return ps;
    }, keys);
    return keys.getKey().longValue();
  }

  private void insertVersionItems(long versionId, List<CalculatedItem> items) {
    for (CalculatedItem item : items) jdbc.update("""
        INSERT INTO order_version_item(order_version_id, line_no, activity_product_id, material_code, material_name,
          category_name, product_line, brand_name, variety_name, specification, case_pack, customer_type, rebate_status,
          is_gift_box, primary_image_object_key, quantity, case_price, applied_tier_min_quantity, base_case_price, base_price_quantity,
          tier_case_price, tier_min_quantity, tier_price_quantity, pricing_mode, line_amount, ton_case_factor, line_tons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, versionId, item.lineNo(), item.product().id(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().customerType(), item.product().rebateStatus(),
        item.product().giftBox(), item.product().imageKey(), item.quantity(), item.pricing().casePriceSnapshot(), item.pricing().appliedTierMinQuantity(),
        item.pricing().baseCasePrice(), item.pricing().baseQuantity(), item.pricing().tierCasePrice(), item.pricing().tierMinQuantity(), item.pricing().tierQuantity(),
        item.pricing().pricingMode(), item.pricing().lineAmount(),
        item.product().tonCaseFactor(), item.lineTons());
  }

  private OrderRow lockOrder(long activityId, long customerId) {
    List<OrderRow> rows = jdbc.query("SELECT id, activity_customer_id, status, current_version_no, lock_version FROM customer_order WHERE activity_id = ? AND activity_customer_id = ? FOR UPDATE",
        this::mapOrderRow, activityId, customerId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private OrderRow lockOrderById(long activityId, long orderId) {
    List<OrderRow> rows = jdbc.query("SELECT id, activity_customer_id, status, current_version_no, lock_version FROM customer_order WHERE activity_id = ? AND id = ? FOR UPDATE",
        this::mapOrderRow, activityId, orderId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private OrderRow mapOrderRow(ResultSet rs, int rowNum) throws SQLException {
    return new OrderRow(rs.getLong("id"), rs.getLong("activity_customer_id"), rs.getString("status"),
        rs.getInt("current_version_no"), rs.getInt("lock_version"));
  }

  private OrderView findByCustomer(long activityId, long customerId) {
    List<Long> ids = jdbc.queryForList("SELECT id FROM customer_order WHERE activity_id = ? AND activity_customer_id = ?", Long.class, activityId, customerId);
    return ids.isEmpty() ? null : order(ids.getFirst());
  }

  private void deleteDraft(long activityId, long customerId) {
    jdbc.update("DELETE FROM h5_order_draft WHERE activity_id = ? AND activity_customer_id = ?", activityId, customerId);
  }

  private OrderView order(long orderId) {
    List<OrderView> rows = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id WHERE o.id = ?
        """, this::mapOrder, orderId);
    if (rows.size() != 1) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    OrderView order = rows.getFirst();
    List<ItemView> items = jdbc.query("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no", this::mapItem, orderId);
    List<OrderVersionView> versions = jdbc.query("""
        SELECT v.*, u.display_name submitted_by_admin_name FROM order_version v
        LEFT JOIN admin_user u ON u.id = v.submitted_by_admin_id
        WHERE v.order_id = ? ORDER BY v.version_no DESC
        """, this::mapVersion, orderId)
        .stream().map(this::withVersionItems).toList();
    List<OperationView> operations = jdbc.query("""
        SELECT o.operation_type, o.source, u.display_name admin_name, o.order_version_no, o.reason, o.occurred_at
        FROM order_operation o LEFT JOIN admin_user u ON u.id = o.admin_user_id
        WHERE o.order_id = ? ORDER BY o.occurred_at DESC, o.id DESC
        """, this::mapOperation, orderId);
    return new OrderView(order.id(), order.activityId(), order.activityCustomerId(), order.orderNo(), order.status(),
        order.createdSource(), order.lastModifiedSource(), order.lockVersion(), order.customerType(), order.regionCode(),
        order.branchName(), order.dealerShortName(), order.dealerFullName(), order.phoneMasked(), order.currentVersion(),
        order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(),
        order.lastModifiedAt(), order.withdrawnAt(), order.withdrawnReason(), order.voidedAt(), order.voidedReason(),
        items, versions, operations);
  }

  private AdminOrderView adminView(OrderView order) {
    List<String> rows = jdbc.query("SELECT phone FROM activity_customer WHERE id = ?",
        (rs, rowNum) -> rs.getString("phone"), order.activityCustomerId());
    String phone = rows.isEmpty() ? null : rows.getFirst();
    return new AdminOrderView(order.id(), order.activityId(), order.activityCustomerId(), order.orderNo(), order.status(),
        order.createdSource(), order.lastModifiedSource(), order.lockVersion(), order.customerType(), order.regionCode(),
        order.branchName(), order.dealerShortName(), order.dealerFullName(), phone, order.phoneMasked(), order.currentVersion(),
        order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(),
        order.lastModifiedAt(), order.withdrawnAt(), order.withdrawnReason(), order.voidedAt(), order.voidedReason(),
        order.items(), order.versions(), order.operations());
  }

  private OrderVersionView withVersionItems(OrderVersionView version) {
    List<ItemView> items = jdbc.query("SELECT * FROM order_version_item WHERE order_version_id = ? ORDER BY line_no", this::mapVersionItem, version.id());
    return new OrderVersionView(version.id(), version.version(), version.totalQuantity(), version.totalTons(), version.totalAmount(),
        version.submittedAt(), version.submittedSource(), version.submittedByAdminName(), version.reason(), items);
  }

  private IdempotencyResult beginIdempotency(long activityId, long actorId, String endpoint, String key, byte[] hash) {
    return beginIdempotency(activityId, "H5_CUSTOMER", actorId, endpoint, key, hash);
  }

  private IdempotencyResult beginIdempotency(long activityId, String actorType, long actorId, String endpoint,
                                              String key, byte[] hash) {
    if (key == null || key.isBlank() || key.length() > 128) throw DomainException.badRequest("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key");
    int inserted = jdbc.update("""
        INSERT IGNORE INTO api_idempotency(activity_id, actor_type, actor_id, endpoint_code, idempotency_key,
          request_hash, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY))
        """, activityId, actorType, actorId, endpoint, key, hash);
    if (inserted == 1) return new IdempotencyResult(false);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT request_hash, status FROM api_idempotency WHERE activity_id = ? AND actor_type = ?
          AND actor_id = ? AND endpoint_code = ? AND idempotency_key = ? FOR UPDATE
        """, activityId, actorType, actorId, endpoint, key);
    if (rows.size() != 1 || !MessageDigest.isEqual((byte[]) rows.getFirst().get("request_hash"), hash)) {
      throw DomainException.conflict("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求");
    }
    String status = rows.getFirst().get("status").toString();
    if ("COMPLETED".equals(status)) return new IdempotencyResult(true);
    throw DomainException.conflict("REQUEST_IN_PROGRESS", "相同请求正在处理中，请稍后查询订单");
  }

  private void completeIdempotency(long activityId, long actorId, String endpoint, String key, long orderId) {
    completeIdempotency(activityId, "H5_CUSTOMER", actorId, endpoint, key, orderId);
  }

  private void completeIdempotency(long activityId, String actorType, long actorId, String endpoint, String key, long orderId) {
    jdbc.update("""
        UPDATE api_idempotency SET status = 'COMPLETED', http_status = 200, resource_type = 'ORDER', resource_id = ?,
          response_json = JSON_OBJECT('orderId', ?), completed_at = UTC_TIMESTAMP(3)
        WHERE activity_id = ? AND actor_type = ? AND actor_id = ? AND endpoint_code = ? AND idempotency_key = ?
        """, orderId, orderId, activityId, actorType, actorId, endpoint, key);
  }

  private void writeOutbox(long activityId, long orderId, String event, Object payload) {
    try {
      jdbc.update("""
          INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
          VALUES (?, 'ORDER', ?, ?, ?, UTC_TIMESTAMP(3))
          """, activityId, Long.toString(orderId), event, json.writeValueAsString(payload));
    } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  private byte[] hash(Object value) {
    try { return MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(value)); }
    catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private static void requireIdentity(long activityId, H5Principal customer) { if (customer.activityId() != activityId) throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动"); }
  private static String orderNo(long activityId) { return "ZY" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC).format(Instant.now()) + String.format("%02d", activityId % 100) + UUID.randomUUID().toString().substring(0, 4).toUpperCase(Locale.ROOT); }
  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", ""); }

  private ProductSnapshot mapProduct(ResultSet rs, int rowNum) throws SQLException { return new ProductSnapshot(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"), rs.getString("specification"), rs.getString("case_pack"), rs.getString("customer_type"), rs.getString("rebate_status"), rs.getBoolean("is_gift_box"), rs.getBigDecimal("case_price"), rs.getBigDecimal("ton_case_factor"), rs.getString("image_key"), nullableLong(rs, "price_tier_min_quantity"), rs.getBigDecimal("price_tier_case_price"), rs.getString("price_tier_pricing_mode")); }
  private OrderView mapOrder(ResultSet rs, int rowNum) throws SQLException { return new OrderView(rs.getLong("id"), rs.getLong("activity_id"), rs.getLong("activity_customer_id"), rs.getString("order_no"), rs.getString("status"), rs.getString("created_source"), rs.getString("last_modified_source"), rs.getInt("lock_version"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_short_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("first_submitted_at").toInstant(), rs.getTimestamp("last_submitted_at").toInstant(), rs.getTimestamp("last_modified_at").toInstant(), instant(rs, "withdrawn_at"), rs.getString("withdrawn_reason"), instant(rs, "voided_at"), rs.getString("voided_reason"), List.of(), List.of(), List.of()); }
  private OrderSummary mapSummary(ResultSet rs, int rowNum) throws SQLException { return new OrderSummary(rs.getLong("id"), rs.getString("order_no"), rs.getString("status"), rs.getString("created_source"), rs.getString("last_modified_source"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getInt("lock_version"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("first_submitted_at").toInstant(), rs.getTimestamp("last_submitted_at").toInstant(), rs.getTimestamp("last_modified_at").toInstant()); }
  private ItemView mapItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }
  private ItemView mapVersionItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }
  private ItemView item(ResultSet rs, String idColumn, String productColumn) throws SQLException { return new ItemView(rs.getLong(idColumn), rs.getObject(productColumn) == null ? null : rs.getLong(productColumn), rs.getInt("line_no"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("product_line"), rs.getString("specification"), rs.getString("case_pack"), rs.getLong("quantity"), rs.getBigDecimal("case_price"), nullableLong(rs, "applied_tier_min_quantity"), rs.getBigDecimal("base_case_price"), nullableLong(rs, "base_price_quantity"), rs.getBigDecimal("tier_case_price"), nullableLong(rs, "tier_min_quantity"), nullableLong(rs, "tier_price_quantity"), rs.getString("pricing_mode"), rs.getBigDecimal("line_amount"), rs.getBigDecimal("ton_case_factor"), rs.getBigDecimal("line_tons")); }
  private OrderVersionView mapVersion(ResultSet rs, int rowNum) throws SQLException { return new OrderVersionView(rs.getLong("id"), rs.getInt("version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("submitted_at").toInstant(), rs.getString("submitted_source"), rs.getString("submitted_by_admin_name"), rs.getString("reason"), List.of()); }
  private OperationView mapOperation(ResultSet rs, int rowNum) throws SQLException { return new OperationView(rs.getString("operation_type"), rs.getString("source"), rs.getString("admin_name"), rs.getObject("order_version_no") == null ? null : rs.getInt("order_version_no"), rs.getString("reason"), rs.getTimestamp("occurred_at").toInstant()); }

  private record OrderRow(long id, long customerId, String status, int version, int lockVersion) {}
  private static Long nullableLong(ResultSet rs, String column) throws SQLException { long value = rs.getLong(column); return rs.wasNull() ? null : value; }
  private static Instant instant(ResultSet rs, String column) throws SQLException { Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant(); }
  static PricingResult calculatePrice(BigDecimal basePrice, Long tierMinQuantity, BigDecimal tierCasePrice, String pricingMode, long quantity) {
    if (tierMinQuantity == null || tierCasePrice == null) {
      return new PricingResult(basePrice, basePrice, quantity, null, null, 0, null, null,
          basePrice.multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP));
    }
    String mode = pricingMode == null || pricingMode.isBlank() ? "WHOLE_ORDER" : pricingMode;
    long baseQuantity;
    long tierQuantity;
    BigDecimal casePriceSnapshot;
    if ("INCREMENTAL".equals(mode)) {
      baseQuantity = Math.min(quantity, tierMinQuantity - 1);
      tierQuantity = Math.max(0, quantity - baseQuantity);
      casePriceSnapshot = basePrice;
    } else {
      boolean applied = quantity >= tierMinQuantity;
      baseQuantity = applied ? 0 : quantity;
      tierQuantity = applied ? quantity : 0;
      casePriceSnapshot = applied ? tierCasePrice : basePrice;
    }
    BigDecimal amount = basePrice.multiply(BigDecimal.valueOf(baseQuantity))
        .add(tierCasePrice.multiply(BigDecimal.valueOf(tierQuantity))).setScale(2, RoundingMode.HALF_UP);
    return new PricingResult(casePriceSnapshot, basePrice, baseQuantity, tierCasePrice, tierMinQuantity, tierQuantity, mode,
        tierQuantity > 0 ? tierMinQuantity : null, amount);
  }
  record PricingResult(BigDecimal casePriceSnapshot, BigDecimal baseCasePrice, long baseQuantity, BigDecimal tierCasePrice,
                       Long tierMinQuantity, long tierQuantity, String pricingMode, Long appliedTierMinQuantity, BigDecimal lineAmount) {}
  private record ProductSnapshot(long id, String materialCode, String materialName, String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack, String customerType, String rebateStatus, boolean giftBox, BigDecimal casePrice, BigDecimal tonCaseFactor, String imageKey, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode) {}
  private record CalculatedItem(int lineNo, ProductSnapshot product, long quantity, PricingResult pricing, BigDecimal lineTons) {}
  private record CalculatedOrder(List<CalculatedItem> items, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount) {}
  private record CustomerSnapshot(long id, String customerType, String regionCode, String branchName,
                                  String dealerShortName, String dealerFullName) {}
  private record IdempotencyResult(boolean replay) {}
  public record SubmitItem(long productId, long quantity) {}
  public record SubmitRequest(int expectedVersion, List<SubmitItem> items) {}
  public record WithdrawRequest(int expectedVersion) {}
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
