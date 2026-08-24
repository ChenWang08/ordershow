package com.fengyi.ordershow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.PageResponse;
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
  private final ObjectMapper json;

  public OrderService(JdbcTemplate jdbc, ActivityService activities, ObjectMapper json) {
    this.jdbc = jdbc;
    this.activities = activities;
    this.json = json;
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
    if (replay.replay()) return findByCustomer(activity.id(), customer.customerId());

    OrderRow current = lockOrder(activity.id(), customer.customerId());
    int currentVersion = current == null ? 0 : current.version();
    if (request.expectedVersion() != currentVersion) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单已在其他页面更新，请刷新后重试");
    if (current != null && "SUBMITTED".equals(current.status()) && sameItems(current.id(), quantities)) {
      completeIdempotency(activity.id(), customer.customerId(), "ORDER_SUBMIT", idempotencyKey, current.id());
      return order(current.id());
    }

    List<ProductSnapshot> products = loadProducts(activity.id(), customer, quantities.keySet());
    if (products.size() != quantities.size()) throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "订单中包含不可订、已删除或不属于当前客户的商品");
    List<CalculatedItem> items = new ArrayList<>();
    long totalQuantity = 0;
    BigDecimal totalAmount = BigDecimal.ZERO.setScale(2);
    BigDecimal totalTons = BigDecimal.ZERO.setScale(6);
    boolean tonsAvailable = true;
    int line = 0;
    for (ProductSnapshot product : products) {
      long quantity = quantities.get(product.id());
      BigDecimal amount = product.casePrice().multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP);
      BigDecimal lineTons = product.tonCaseFactor() == null ? null : BigDecimal.valueOf(quantity).divide(product.tonCaseFactor(), 6, RoundingMode.HALF_UP);
      items.add(new CalculatedItem(++line, product, quantity, amount, lineTons));
      totalQuantity += quantity;
      totalAmount = totalAmount.add(amount);
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
    return order(orderId);
  }

  @Transactional
  public OrderView withdraw(String activityCode, H5Principal customer, int expectedVersion, String idempotencyKey, String traceId) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    activities.requireWritable(activity.id());
    byte[] requestHash = hash(Map.of("expectedVersion", expectedVersion));
    IdempotencyResult replay = beginIdempotency(activity.id(), customer.customerId(), "ORDER_WITHDRAW", idempotencyKey, requestHash);
    if (replay.replay()) return findByCustomer(activity.id(), customer.customerId());
    OrderRow order = lockOrder(activity.id(), customer.customerId());
    if (order == null) throw DomainException.notFound("ORDER_NOT_FOUND", "尚未提交订单");
    if (order.version() != expectedVersion) throw DomainException.conflict("ORDER_VERSION_CONFLICT", "订单版本已变化，请刷新后重试");
    if ("WITHDRAWN".equals(order.status())) {
      completeIdempotency(activity.id(), customer.customerId(), "ORDER_WITHDRAW", idempotencyKey, order.id());
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
    return order(order.id());
  }

  public PageResponse<OrderSummary> adminOrders(long activityId, String status, String customerType, String keyword,
                                                 int page, int size, String traceId) {
    int safePage = Math.max(page, 1), safeSize = Math.min(Math.max(size, 1), 200), offset = (safePage - 1) * safeSize;
    String where = " WHERE o.activity_id = ? AND (? IS NULL OR ? = '' OR o.status = ?) AND (? IS NULL OR ? = '' OR o.customer_type = ?) " +
        "AND (? IS NULL OR ? = '' OR o.order_no LIKE CONCAT('%', ?, '%') OR o.dealer_full_name_snapshot LIKE CONCAT('%', ?, '%') OR c.phone_masked LIKE CONCAT('%', ?, '%'))";
    Object[] args = {activityId, status, status, status, customerType, customerType, customerType, keyword, keyword, keyword, keyword, keyword};
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where, Long.class, args);
    List<Object> pagedArgs = new ArrayList<>(java.util.Arrays.asList(args)); pagedArgs.add(safeSize); pagedArgs.add(offset);
    List<OrderSummary> data = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC LIMIT ? OFFSET ?", this::mapSummary, pagedArgs.toArray());
    return PageResponse.of(data, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  public OrderView adminOrder(long activityId, long orderId) {
    OrderView order = order(orderId);
    if (order.activityId() != activityId) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    return order;
  }

  public List<OrderVersionView> versions(long activityId, long orderId) {
    adminOrder(activityId, orderId);
    return jdbc.query("SELECT * FROM order_version WHERE order_id = ? ORDER BY version_no DESC", this::mapVersion, orderId)
        .stream().map(this::withVersionItems).toList();
  }

  public List<OperationView> operations(long activityId, long orderId) {
    adminOrder(activityId, orderId);
    return jdbc.query("""
        SELECT operation_type, source, order_version_no, reason, occurred_at FROM order_operation
        WHERE order_id = ? ORDER BY occurred_at DESC, id DESC
        """, (rs, rowNum) -> new OperationView(rs.getString(1), rs.getString(2), rs.getObject(3) == null ? null : rs.getInt(3), rs.getString(4), rs.getTimestamp(5).toInstant()), orderId);
  }

  public byte[] export(long activityId, String status, String customerType, String keyword) {
    String where = " WHERE o.activity_id = ? AND (? IS NULL OR ? = '' OR o.status = ?) AND (? IS NULL OR ? = '' OR o.customer_type = ?) " +
        "AND (? IS NULL OR ? = '' OR o.order_no LIKE CONCAT('%', ?, '%') OR o.dealer_full_name_snapshot LIKE CONCAT('%', ?, '%') OR c.phone_masked LIKE CONCAT('%', ?, '%'))";
    Object[] args = {activityId, status, status, status, customerType, customerType, customerType, keyword, keyword, keyword, keyword, keyword};
    List<OrderSummary> orders = jdbc.query("SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where + " ORDER BY o.last_modified_at DESC, o.id DESC", this::mapSummary, args);
    try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("订单汇总");
      String[] headers = {"订单编号", "状态", "客户类型", "大区", "分公司", "经销商", "电话", "版本", "订货箱数", "订货吨数", "订单金额", "首次提交", "最后提交", "最后修改"};
      Row header = sheet.createRow(0); for (int i = 0; i < headers.length; i++) header.createCell(i).setCellValue(headers[i]);
      int rowNo = 1;
      for (OrderSummary order : orders) {
        Row row = sheet.createRow(rowNo++); int i = 0;
        Object[] values = {order.orderNo(), order.status(), order.customerType(), order.regionCode(), order.branchName(), order.dealerFullName(),
            order.phoneMasked(), order.currentVersion(), order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(), order.lastModifiedAt()};
        for (Object value : values) row.createCell(i++).setCellValue(value == null ? "" : value.toString());
      }
      for (int i = 0; i < headers.length; i++) sheet.autoSizeColumn(i);
      workbook.write(output); return output.toByteArray();
    } catch (Exception exception) { throw new IllegalStateException("订单导出失败", exception); }
  }

  private List<ProductSnapshot> loadProducts(long activityId, H5Principal customer, Set<Long> ids) {
    if (ids.isEmpty()) return List.of();
    String placeholders = ids.stream().map(id -> "?").collect(Collectors.joining(","));
    List<Object> args = new ArrayList<>(); args.add(activityId); args.add(customer.customerType()); args.add(normalize(customer.branchName())); args.addAll(ids);
    return jdbc.query("""
        SELECT p.*, (SELECT sf.object_key FROM product_image pi JOIN stored_file sf ON sf.id = pi.stored_file_id
          WHERE pi.activity_product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.is_primary DESC, pi.sort_no, pi.id LIMIT 1) image_key
        FROM activity_product p JOIN activity_data_binding b ON b.current_version_id = p.data_version_id AND b.activity_id = p.activity_id AND b.data_type = 'PRODUCT'
        WHERE p.activity_id = ? AND p.customer_type = ? AND p.is_visible = TRUE AND p.is_orderable = TRUE
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
          AND p.id IN (""" + placeholders + ") ORDER BY p.sort_no, p.id", this::mapProduct, args.toArray());
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
          primary_image_object_key, quantity, case_price, line_amount, ton_case_factor, line_tons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, orderId, item.product().id(), item.lineNo(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().rebateStatus(), item.product().giftBox(),
        item.product().imageKey(), item.quantity(), item.product().casePrice(), item.lineAmount(), item.product().tonCaseFactor(), item.lineTons());
  }

  private long insertVersion(long activityId, long orderId, int version, H5Principal customer, long totalQuantity,
                             BigDecimal totalTons, BigDecimal totalAmount, String idempotencyKey) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var ps = connection.prepareStatement("""
          INSERT INTO order_version(activity_id, order_id, version_no, customer_type, region_code, branch_name_snapshot,
            dealer_short_name_snapshot, dealer_full_name_snapshot, total_quantity, total_tons, total_amount,
            submitted_source, submitted_at, request_idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'H5', UTC_TIMESTAMP(3), ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int i = 0; ps.setLong(++i, activityId); ps.setLong(++i, orderId); ps.setInt(++i, version); ps.setString(++i, customer.customerType());
      ps.setString(++i, customer.regionCode()); ps.setString(++i, customer.branchName()); ps.setString(++i, customer.dealerShortName());
      ps.setString(++i, customer.dealerFullName()); ps.setLong(++i, totalQuantity); ps.setBigDecimal(++i, totalTons);
      ps.setBigDecimal(++i, totalAmount); ps.setString(++i, idempotencyKey); return ps;
    }, keys);
    return keys.getKey().longValue();
  }

  private void insertVersionItems(long versionId, List<CalculatedItem> items) {
    for (CalculatedItem item : items) jdbc.update("""
        INSERT INTO order_version_item(order_version_id, line_no, activity_product_id, material_code, material_name,
          category_name, product_line, brand_name, variety_name, specification, case_pack, customer_type, rebate_status,
          is_gift_box, primary_image_object_key, quantity, case_price, line_amount, ton_case_factor, line_tons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, versionId, item.lineNo(), item.product().id(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().customerType(), item.product().rebateStatus(),
        item.product().giftBox(), item.product().imageKey(), item.quantity(), item.product().casePrice(), item.lineAmount(),
        item.product().tonCaseFactor(), item.lineTons());
  }

  private OrderRow lockOrder(long activityId, long customerId) {
    List<OrderRow> rows = jdbc.query("SELECT id, status, current_version_no, lock_version FROM customer_order WHERE activity_id = ? AND activity_customer_id = ? FOR UPDATE",
        (rs, rowNum) -> new OrderRow(rs.getLong(1), rs.getString(2), rs.getInt(3), rs.getInt(4)), activityId, customerId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private OrderView findByCustomer(long activityId, long customerId) {
    List<Long> ids = jdbc.queryForList("SELECT id FROM customer_order WHERE activity_id = ? AND activity_customer_id = ?", Long.class, activityId, customerId);
    return ids.isEmpty() ? null : order(ids.getFirst());
  }

  private OrderView order(long orderId) {
    List<OrderView> rows = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id WHERE o.id = ?
        """, this::mapOrder, orderId);
    if (rows.size() != 1) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    OrderView order = rows.getFirst();
    List<ItemView> items = jdbc.query("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no", this::mapItem, orderId);
    List<OrderVersionView> versions = jdbc.query("SELECT * FROM order_version WHERE order_id = ? ORDER BY version_no DESC", this::mapVersion, orderId)
        .stream().map(this::withVersionItems).toList();
    List<OperationView> operations = jdbc.query("SELECT operation_type, source, order_version_no, reason, occurred_at FROM order_operation WHERE order_id = ? ORDER BY occurred_at DESC, id DESC",
        (rs, rowNum) -> new OperationView(rs.getString(1), rs.getString(2), rs.getObject(3) == null ? null : rs.getInt(3), rs.getString(4), rs.getTimestamp(5).toInstant()), orderId);
    return new OrderView(order.id(), order.activityId(), order.orderNo(), order.status(), order.customerType(), order.regionCode(),
        order.branchName(), order.dealerShortName(), order.dealerFullName(), order.phoneMasked(), order.currentVersion(),
        order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(),
        order.lastModifiedAt(), order.withdrawnAt(), order.withdrawnReason(), items, versions, operations);
  }

  private OrderVersionView withVersionItems(OrderVersionView version) {
    List<ItemView> items = jdbc.query("SELECT * FROM order_version_item WHERE order_version_id = ? ORDER BY line_no", this::mapVersionItem, version.id());
    return new OrderVersionView(version.id(), version.version(), version.totalQuantity(), version.totalTons(), version.totalAmount(), version.submittedAt(), version.submittedSource(), items);
  }

  private IdempotencyResult beginIdempotency(long activityId, long actorId, String endpoint, String key, byte[] hash) {
    if (key == null || key.isBlank() || key.length() > 128) throw DomainException.badRequest("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key");
    int inserted = jdbc.update("""
        INSERT IGNORE INTO api_idempotency(activity_id, actor_type, actor_id, endpoint_code, idempotency_key,
          request_hash, status, expires_at) VALUES (?, 'H5_CUSTOMER', ?, ?, ?, ?, 'PROCESSING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))
        """, activityId, actorId, endpoint, key, hash);
    if (inserted == 1) return new IdempotencyResult(false);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT request_hash, status FROM api_idempotency WHERE activity_id = ? AND actor_type = 'H5_CUSTOMER'
          AND actor_id = ? AND endpoint_code = ? AND idempotency_key = ? FOR UPDATE
        """, activityId, actorId, endpoint, key);
    if (rows.size() != 1 || !MessageDigest.isEqual((byte[]) rows.getFirst().get("request_hash"), hash)) {
      throw DomainException.conflict("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求");
    }
    String status = rows.getFirst().get("status").toString();
    if ("COMPLETED".equals(status)) return new IdempotencyResult(true);
    throw DomainException.conflict("REQUEST_IN_PROGRESS", "相同请求正在处理中，请稍后查询订单");
  }

  private void completeIdempotency(long activityId, long actorId, String endpoint, String key, long orderId) {
    jdbc.update("""
        UPDATE api_idempotency SET status = 'COMPLETED', http_status = 200, resource_type = 'ORDER', resource_id = ?,
          response_json = JSON_OBJECT('orderId', ?), completed_at = UTC_TIMESTAMP(3)
        WHERE activity_id = ? AND actor_type = 'H5_CUSTOMER' AND actor_id = ? AND endpoint_code = ? AND idempotency_key = ?
        """, orderId, orderId, activityId, actorId, endpoint, key);
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

  private ProductSnapshot mapProduct(ResultSet rs, int rowNum) throws SQLException { return new ProductSnapshot(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"), rs.getString("specification"), rs.getString("case_pack"), rs.getString("customer_type"), rs.getString("rebate_status"), rs.getBoolean("is_gift_box"), rs.getBigDecimal("case_price"), rs.getBigDecimal("ton_case_factor"), rs.getString("image_key")); }
  private OrderView mapOrder(ResultSet rs, int rowNum) throws SQLException { return new OrderView(rs.getLong("id"), rs.getLong("activity_id"), rs.getString("order_no"), rs.getString("status"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_short_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("first_submitted_at").toInstant(), rs.getTimestamp("last_submitted_at").toInstant(), rs.getTimestamp("last_modified_at").toInstant(), rs.getTimestamp("withdrawn_at") == null ? null : rs.getTimestamp("withdrawn_at").toInstant(), rs.getString("withdrawn_reason"), List.of(), List.of(), List.of()); }
  private OrderSummary mapSummary(ResultSet rs, int rowNum) throws SQLException { return new OrderSummary(rs.getLong("id"), rs.getString("order_no"), rs.getString("status"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("first_submitted_at").toInstant(), rs.getTimestamp("last_submitted_at").toInstant(), rs.getTimestamp("last_modified_at").toInstant()); }
  private ItemView mapItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }
  private ItemView mapVersionItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }
  private ItemView item(ResultSet rs, String idColumn, String productColumn) throws SQLException { return new ItemView(rs.getLong(idColumn), rs.getObject(productColumn) == null ? null : rs.getLong(productColumn), rs.getInt("line_no"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("product_line"), rs.getString("specification"), rs.getString("case_pack"), rs.getLong("quantity"), rs.getBigDecimal("case_price"), rs.getBigDecimal("line_amount"), rs.getBigDecimal("ton_case_factor"), rs.getBigDecimal("line_tons")); }
  private OrderVersionView mapVersion(ResultSet rs, int rowNum) throws SQLException { return new OrderVersionView(rs.getLong("id"), rs.getInt("version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("submitted_at").toInstant(), rs.getString("submitted_source"), List.of()); }

  private record OrderRow(long id, String status, int version, int lockVersion) {}
  private record ProductSnapshot(long id, String materialCode, String materialName, String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack, String customerType, String rebateStatus, boolean giftBox, BigDecimal casePrice, BigDecimal tonCaseFactor, String imageKey) {}
  private record CalculatedItem(int lineNo, ProductSnapshot product, long quantity, BigDecimal lineAmount, BigDecimal lineTons) {}
  private record IdempotencyResult(boolean replay) {}
  public record SubmitItem(long productId, long quantity) {}
  public record SubmitRequest(int expectedVersion, List<SubmitItem> items) {}
  public record WithdrawRequest(int expectedVersion) {}
  public record ItemView(long id, Long productId, int lineNo, String materialCode, String materialName, String productLine, String specification, String casePack, long quantity, BigDecimal casePrice, BigDecimal lineAmount, BigDecimal tonCaseFactor, BigDecimal lineTons) {}
  public record OrderVersionView(long id, int version, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, Instant submittedAt, String submittedSource, List<ItemView> items) {}
  public record OperationView(String type, String source, Integer orderVersion, String reason, Instant occurredAt) {}
  public record OrderSummary(long id, String orderNo, String status, String customerType, String regionCode, String branchName, String dealerFullName, String phoneMasked, int currentVersion, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, Instant firstSubmittedAt, Instant lastSubmittedAt, Instant lastModifiedAt) {}
  public record OrderView(long id, long activityId, String orderNo, String status, String customerType, String regionCode, String branchName, String dealerShortName, String dealerFullName, String phoneMasked, int currentVersion, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, Instant firstSubmittedAt, Instant lastSubmittedAt, Instant lastModifiedAt, Instant withdrawnAt, String withdrawnReason, List<ItemView> items, List<OrderVersionView> versions, List<OperationView> operations) {}
}
