package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.common.TierPricing;
import com.fengyi.ordershow.common.TierPricing.Step;

import static com.fengyi.ordershow.order.OrderData.*;
import com.fengyi.ordershow.order.OrderService.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;

import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;


/** Uses the caller's transaction; lock order and SQL predicates are preserved. */
@Repository
public class OrderRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private com.fengyi.ordershow.dashboard.DashboardSummaryStore summaries;
  public OrderRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

  @org.springframework.beans.factory.annotation.Autowired
  public OrderRepository(JdbcTemplate jdbc, ObjectMapper json,
      com.fengyi.ordershow.dashboard.DashboardSummaryStore summaries) {
    this(jdbc, json);
    this.summaries = summaries;
  }

  AdminOrderView adminOrder(long activityId, long orderId) {
    OrderView order = order(orderId);
    if (order.activityId() != activityId) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    return adminView(order);
  }

  List<OrderVersionView> versions(long activityId, long orderId) {
    requireOrderAccess(activityId, orderId);
    int currentVersion = jdbc.queryForObject(
        "SELECT current_version_no FROM customer_order WHERE id = ?", Integer.class, orderId);
    return withCurrentVersionItems(orderId, currentVersion, jdbc.query("""
        SELECT v.*, COALESCE(v.actor_identity_snapshot,u.display_name) submitted_by_admin_name FROM order_version v
        LEFT JOIN admin_user u ON u.id = v.submitted_by_admin_id
        WHERE v.order_id = ? ORDER BY v.version_no DESC
        """, this::mapVersion, orderId));
  }

  List<OperationView> operations(long activityId, long orderId) {
    requireOrderAccess(activityId, orderId);
    return jdbc.query("""
        SELECT o.operation_type, o.source, COALESCE(o.actor_identity_snapshot,u.display_name) admin_name, o.order_version_no, o.reason, o.occurred_at
        FROM order_operation o LEFT JOIN admin_user u ON u.id = o.admin_user_id
        WHERE o.order_id = ? ORDER BY o.occurred_at DESC, o.id DESC
        """, this::mapOperation, orderId);
  }

  List<ProductSnapshot> loadProducts(long activityId, long activityCustomerId, String customerType, String branchName, Set<Long> ids) {
    if (ids.isEmpty()) return List.of();
    String placeholders = ids.stream().map(id -> "?").collect(Collectors.joining(","));
    Integer dealerScopes = jdbc.queryForObject("""
        SELECT EXISTS(SELECT 1 FROM activity_product_dealer_scope s
          JOIN activity_product dp ON dp.id = s.activity_product_id WHERE dp.activity_id = ?)
        """, Integer.class, activityId);
    boolean dealerScoped = dealerScopes != null && dealerScopes == 1;
    String dealerSql = dealerScoped ? """
          AND (NOT EXISTS (SELECT 1 FROM activity_product_dealer_scope ds
                 WHERE ds.activity_product_id = p.id AND ds.normalized_branch_name = dc.normalized_branch_name)
            OR EXISTS (SELECT 1 FROM activity_product_dealer_member dm
                 WHERE dm.activity_product_id = p.id AND dm.normalized_branch_name = dc.normalized_branch_name
                   AND dm.customer_id = dc.customer_id AND dm.customer_type = dc.customer_type
                   AND dm.normalized_dealer_full_name = dc.normalized_dealer_full_name))
        """ : "";
    List<Object> args = new ArrayList<>();
    args.addAll(ids); args.addAll(ids);
    args.add(activityId); args.add(customerType); args.add(customerType); args.add(normalize(branchName)); args.add(activityCustomerId); args.addAll(ids);
    return jdbc.query("""
        SELECT p.*, img.object_key image_key, t.min_quantity price_tier_min_quantity, t.case_price price_tier_case_price,
          t.pricing_mode price_tier_pricing_mode, t.price_tiers
        FROM activity_product p
        JOIN activity_data_binding b ON b.current_version_id = p.data_version_id AND b.activity_id = p.activity_id AND b.data_type = 'PRODUCT'
        LEFT JOIN (
          SELECT activity_product_id, MIN(min_quantity) min_quantity, MAX(case_price) case_price, MIN(pricing_mode) pricing_mode,
            JSON_ARRAYAGG(JSON_OBJECT('minQuantity',min_quantity,'casePrice',case_price)) price_tiers
          FROM activity_product_price_tier WHERE activity_product_id IN (""" + placeholders + """
          ) GROUP BY activity_product_id
        ) t ON t.activity_product_id = p.id
        LEFT JOIN (
          SELECT activity_product_id, object_key FROM (
            SELECT pi.activity_product_id, sf.object_key,
              ROW_NUMBER() OVER (PARTITION BY pi.activity_product_id ORDER BY pi.is_primary DESC, pi.sort_no, pi.id) rn
            FROM product_image pi JOIN stored_file sf ON sf.id = pi.stored_file_id
            WHERE pi.deleted_at IS NULL AND pi.activity_product_id IN (""" + placeholders + """
            )
          ) ranked WHERE rn = 1
        ) img ON img.activity_product_id = p.id
        WHERE p.activity_id = ? AND (? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL') AND p.is_visible = TRUE AND p.is_orderable = TRUE
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
          AND EXISTS (SELECT 1 FROM activity_customer dc
            JOIN activity_data_binding db ON db.activity_id = dc.activity_id AND db.data_type = 'WHITELIST'
              AND db.current_version_id = dc.data_version_id
            WHERE dc.id = ? AND dc.activity_id = p.activity_id AND dc.is_active = TRUE
              AND (p.customer_type = 'ALL' OR p.customer_type = dc.customer_type)
        """ + dealerSql + """
          ) AND p.id IN (""" + placeholders + ") ORDER BY p.sort_no, p.id", this::mapProduct, args.toArray());
  }

  CustomerSnapshot adminCustomer(long activityId, long activityCustomerId) {
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

  CustomerSnapshot orderCustomer(long activityId, long activityCustomerId) {
    List<CustomerSnapshot> rows = jdbc.query("""
        SELECT id, customer_type, region_code, branch_name, dealer_short_name, dealer_full_name
        FROM activity_customer WHERE id = ? AND activity_id = ?
        """, (rs, rowNum) -> new CustomerSnapshot(rs.getLong("id"), rs.getString("customer_type"),
        rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"),
        rs.getString("dealer_full_name")), activityCustomerId, activityId);
    if (rows.size() != 1) throw DomainException.notFound("CUSTOMER_NOT_FOUND", "订单关联客户不存在");
    return rows.getFirst();
  }

  long insertAdminOrder(long activityId, CustomerSnapshot customer, CalculatedOrder calculated, long adminId) {
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

  void insertOperation(long activityId, long orderId, String operation, String source, Long adminId,
                               Integer version, String reason, String traceId) {
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, admin_user_id,
          order_version_no, reason, trace_id, occurred_at, actor_identity_snapshot, actor_role_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3),
          (SELECT CONCAT(display_name,'（',username,'）') FROM admin_user WHERE id=?),
          (SELECT role_code FROM admin_user WHERE id=?))
        """, activityId, orderId, operation, source, adminId, version, reason, traceId, adminId, adminId);
  }

  Map<Long, Long> currentQuantities(long orderId) {
    return jdbc.query("SELECT activity_product_id, quantity FROM order_item WHERE order_id = ?",
        rs -> { Map<Long, Long> map = new HashMap<>(); while (rs.next()) map.put(rs.getLong(1), rs.getLong(2)); return map; }, orderId);
  }

  boolean sameItems(long orderId, Map<Long, Long> expected) {
    return currentQuantities(orderId).equals(expected);
  }

  static boolean hasReducedItems(Map<Long, Long> current, Map<Long, Long> requested) {
    return current.entrySet().stream().anyMatch(item -> requested.getOrDefault(item.getKey(), 0L) < item.getValue());
  }

  boolean hasReducedItems(long orderId, Map<Long, Long> requested) {
    return jdbc.query("SELECT activity_product_id, quantity FROM order_item WHERE order_id = ?",
        rs -> {
          while (rs.next()) {
            if (requested.getOrDefault(rs.getLong(1), 0L) < rs.getLong(2)) return true;
          }
          return false;
        }, orderId);
  }

  void lockPricing(long activityId) {
    jdbc.queryForList("SELECT id FROM activity WHERE id = ? FOR UPDATE", activityId);
  }

  void lockCustomerSubmission(long activityId, long customerId) {
    OrderWriteLock.acquire(jdbc, activityId, customerId);
  }

  void lockCustomerReview(long activityId, long customerId) {
    OrderWriteLock.acquireReview(jdbc, activityId, customerId);
  }

  /** Freeze the still-current version before its lines or its version number change. An existing snapshot is left as-is. */
  void snapshotCurrentVersion(long orderId) {
    snapshotCurrentVersions(List.of(orderId));
  }

  void snapshotCurrentVersions(List<Long> orderIds) {
    snapshotCurrentVersions(orderIds, null);
  }

  /** Price synchronization changes one product only; freeze that line instead of copying every other product. */
  void snapshotCurrentProductVersions(List<Long> orderIds, long productId) {
    snapshotCurrentVersions(orderIds, productId);
  }

  private void snapshotCurrentVersions(List<Long> orderIds, Long productId) {
    if (orderIds.isEmpty()) return;
    String ids = orderIds.stream().map(id -> "?").collect(Collectors.joining(","));
    var args = new ArrayList<Object>(orderIds);
    if (productId != null) args.add(productId);
    jdbc.update("""
        INSERT INTO order_version_item(order_version_id, line_no, activity_product_id, material_code, material_name,
          category_name, product_line, brand_name, variety_name, specification, case_pack, customer_type, rebate_status,
          is_gift_box, primary_image_object_key, quantity, case_price, applied_tier_min_quantity, base_case_price,
          base_price_quantity, tier_case_price, tier_min_quantity, tier_price_quantity, pricing_mode, line_amount,
          ton_case_factor, line_tons, pricing_details)
        SELECT v.id, i.line_no, i.activity_product_id, i.material_code, i.material_name, i.category_name, i.product_line,
          i.brand_name, i.variety_name, i.specification, i.case_pack, o.customer_type, i.rebate_status, i.is_gift_box,
          i.primary_image_object_key, i.quantity, i.case_price, i.applied_tier_min_quantity, i.base_case_price,
          i.base_price_quantity, i.tier_case_price, i.tier_min_quantity, i.tier_price_quantity, i.pricing_mode,
          i.line_amount, i.ton_case_factor, i.line_tons, i.pricing_details
        FROM order_item i
        JOIN customer_order o ON o.id = i.order_id
        JOIN order_version v ON v.order_id = o.id AND v.version_no = o.current_version_no
        WHERE i.order_id IN (""" + ids + """
        )
        """ + (productId == null ? "" : " AND i.activity_product_id=? ") + """
          AND NOT EXISTS (SELECT 1 FROM order_version_item existing WHERE existing.order_version_id = v.id AND existing.line_no = i.line_no)
        """, args.toArray());
  }

  void saveRepriced(long activityId, long orderId, Map<Long, PricingResult> prices, long adminId,
                    String reason, String batchId) {
    snapshotCurrentVersion(orderId);
    for (var entry : prices.entrySet()) {
      var p = entry.getValue();
      jdbc.update("""
          UPDATE order_item SET case_price=?, base_case_price=?, base_price_quantity=?, tier_case_price=?,
            tier_min_quantity=?, tier_price_quantity=?, pricing_mode=?, applied_tier_min_quantity=?, line_amount=?, pricing_details=?
          WHERE order_id=? AND activity_product_id=?
          """, p.casePriceSnapshot(), p.baseCasePrice(), p.baseQuantity(), p.tierCasePrice(), p.tierMinQuantity(),
          p.tierQuantity(), p.pricingMode(), p.appliedTierMinQuantity(), p.lineAmount(), TierPricing.encode(p.pricingDetails()), orderId, entry.getKey());
    }
    jdbc.update("""
        UPDATE customer_order SET total_amount=(SELECT SUM(line_amount) FROM order_item WHERE order_id=?),
          current_version_no=current_version_no+1, lock_version=lock_version+1,
          last_modified_at=UTC_TIMESTAMP(3), last_modified_source='ADMIN', last_modified_admin_id=?
        WHERE id=? AND activity_id=? AND status='SUBMITTED'
        """, orderId, adminId, orderId, activityId);
    jdbc.update("""
        INSERT INTO order_version(activity_id,order_id,version_no,customer_type,region_code,branch_name_snapshot,
          dealer_short_name_snapshot,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,
          submitted_source,submitted_by_admin_id,reason,submitted_at,request_idempotency_key)
        SELECT activity_id,id,current_version_no,customer_type,region_code,branch_name_snapshot,
          dealer_short_name_snapshot,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,
          'ADMIN',?,?,UTC_TIMESTAMP(3),? FROM customer_order WHERE id=?
        """, adminId, reason, batchId, orderId);
    long versionId = jdbc.queryForObject("SELECT id FROM order_version WHERE order_id=? AND request_idempotency_key=?", Long.class, orderId, batchId);
    snapshotVersionActor(versionId, adminId);
    int version = jdbc.queryForObject("SELECT current_version_no FROM customer_order WHERE id=?", Integer.class, orderId);
    insertOperation(activityId, orderId, "ADMIN_ADJUST", "ADMIN", adminId, version, reason, batchId.substring(0, Math.min(64, batchId.length())));
    refreshDashboardSummary(orderId);
    writeOutbox(activityId, orderId, "ORDER_ADMIN_ADJUSTED", Map.of("orderId", orderId, "version", version));
  }

  void insertCurrentItems(long orderId, List<CalculatedItem> items) {
    String sql = """
        INSERT INTO order_item(order_id, activity_product_id, line_no, material_code, material_name, category_name,
          product_line, brand_name, variety_name, specification, case_pack, rebate_status, is_gift_box,
          primary_image_object_key, quantity, case_price, applied_tier_min_quantity, base_case_price, base_price_quantity,
          tier_case_price, tier_min_quantity, tier_price_quantity, pricing_mode, line_amount, ton_case_factor, line_tons, pricing_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;
    List<Object[]> rows = items.stream().map(item -> new Object[]{orderId, item.product().id(), item.lineNo(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().rebateStatus(), item.product().giftBox(),
        item.product().imageKey(), item.quantity(), item.pricing().casePriceSnapshot(), item.pricing().appliedTierMinQuantity(),
        item.pricing().baseCasePrice(), item.pricing().baseQuantity(), item.pricing().tierCasePrice(), item.pricing().tierMinQuantity(), item.pricing().tierQuantity(),
        item.pricing().pricingMode(), item.pricing().lineAmount(), item.product().tonCaseFactor(), item.lineTons(), TierPricing.encode(item.pricing().pricingDetails())}).toList();
    insertItemBatches(sql, rows);
    refreshDashboardSummary(orderId);
  }

  void refreshDashboardSummary(long orderId) {
    if (summaries != null) summaries.refresh(orderId);
  }

  void refreshPriceSummaries(List<PriceSyncRepository.Change> changes) {
    if (summaries != null) summaries.applyPriceChanges(changes.stream().map(change ->
        new com.fengyi.ordershow.dashboard.DashboardSummaryStore.PriceDelta(change.row().id(), change.row().orderId(),
            change.price().lineAmount().subtract(change.row().lineAmount()))).toList());
  }

  long insertVersion(long activityId, long orderId, int version, H5Principal customer, long totalQuantity,
                             BigDecimal totalTons, BigDecimal totalAmount, String idempotencyKey) {
    return insertVersion(activityId, orderId, version,
        new CustomerSnapshot(customer.customerId(), customer.customerType(), customer.regionCode(), customer.branchName(),
            customer.dealerShortName(), customer.dealerFullName()),
        totalQuantity, totalTons, totalAmount, "H5", null, null, idempotencyKey);
  }

  long insertVersion(long activityId, long orderId, int version, CustomerSnapshot customer, long totalQuantity,
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
    long versionId = keys.getKey().longValue();
    snapshotVersionActor(versionId, adminId);
    return versionId;
  }

  private void snapshotVersionActor(long versionId, Long adminId) {
    if (adminId != null) jdbc.update("UPDATE order_version SET actor_identity_snapshot=(SELECT CONCAT(display_name,'（',username,'）') FROM admin_user WHERE id=?) WHERE id=?", adminId, versionId);
  }

  void insertVersionItems(long versionId, List<CalculatedItem> items) {
    String sql = """
        INSERT INTO order_version_item(order_version_id, line_no, activity_product_id, material_code, material_name,
          category_name, product_line, brand_name, variety_name, specification, case_pack, customer_type, rebate_status,
          is_gift_box, primary_image_object_key, quantity, case_price, applied_tier_min_quantity, base_case_price, base_price_quantity,
          tier_case_price, tier_min_quantity, tier_price_quantity, pricing_mode, line_amount, ton_case_factor, line_tons, pricing_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;
    List<Object[]> rows = items.stream().map(item -> new Object[]{versionId, item.lineNo(), item.product().id(), item.product().materialCode(), item.product().materialName(),
        item.product().categoryName(), item.product().productLine(), item.product().brandName(), item.product().varietyName(),
        item.product().specification(), item.product().casePack(), item.product().customerType(), item.product().rebateStatus(),
        item.product().giftBox(), item.product().imageKey(), item.quantity(), item.pricing().casePriceSnapshot(), item.pricing().appliedTierMinQuantity(),
        item.pricing().baseCasePrice(), item.pricing().baseQuantity(), item.pricing().tierCasePrice(), item.pricing().tierMinQuantity(), item.pricing().tierQuantity(),
        item.pricing().pricingMode(), item.pricing().lineAmount(),
        item.product().tonCaseFactor(), item.lineTons(), TierPricing.encode(item.pricing().pricingDetails())}).toList();
    insertItemBatches(sql, rows);
  }

  // Keep all chunks in the caller's transaction; do not request generated item IDs.
  private void insertItemBatches(String sql, List<Object[]> rows) {
    for (int start = 0; start < rows.size(); start += 100) {
      jdbc.batchUpdate(sql, rows.subList(start, Math.min(start + 100, rows.size())));
    }
  }

  OrderRow lockOrder(long activityId, long customerId) {
    List<OrderRow> rows = jdbc.query("SELECT id, activity_customer_id, status, current_version_no, lock_version FROM customer_order WHERE activity_id = ? AND activity_customer_id = ? FOR UPDATE",
        this::mapOrderRow, activityId, customerId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  OrderRow lockOrderById(long activityId, long orderId) {
    List<OrderRow> rows = jdbc.query("SELECT id, activity_customer_id, status, current_version_no, lock_version FROM customer_order WHERE activity_id = ? AND id = ? FOR UPDATE",
        this::mapOrderRow, activityId, orderId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  OrderRow mapOrderRow(ResultSet rs, int rowNum) throws SQLException {
    return new OrderRow(rs.getLong("id"), rs.getLong("activity_customer_id"), rs.getString("status"),
        rs.getInt("current_version_no"), rs.getInt("lock_version"));
  }

  OrderView findByCustomer(long activityId, long customerId) {
    return findByCustomer(activityId, customerId, true);
  }

  OrderView findByCustomer(long activityId, long customerId, boolean includeHistory) {
    List<OrderView> rows = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        WHERE o.activity_id = ? AND o.activity_customer_id = ?
        """, this::mapOrder, activityId, customerId);
    return rows.isEmpty() ? null : withOrderDetails(rows.getFirst(), includeHistory);
  }

  void deleteDraft(long activityId, long customerId) {
    OrderDraftWrites.delete(jdbc, activityId, customerId);
  }

  OrderView order(long orderId) {
    return order(orderId, true);
  }

  OrderView order(long orderId, boolean includeHistory) {
    List<OrderView> rows = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id WHERE o.id = ?
        """, this::mapOrder, orderId);
    if (rows.size() != 1) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    return withOrderDetails(rows.getFirst(), includeHistory);
  }

  OrderView orderAfterSubmission(long orderId, List<CalculatedItem> items, boolean includeHistory) {
    List<OrderView> rows = jdbc.query("""
        SELECT o.*, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id WHERE o.id = ?
        """, this::mapOrder, orderId);
    if (rows.size() != 1) throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    OrderView base = rows.getFirst();
    List<ItemView> itemViews = assembleSubmittedItems(orderId, items);
    List<OrderVersionView> versions = includeHistory ? withCurrentVersionItems(orderId, base.currentVersion(), jdbc.query("""
        SELECT v.*, COALESCE(v.actor_identity_snapshot,u.display_name) submitted_by_admin_name FROM order_version v
        LEFT JOIN admin_user u ON u.id = v.submitted_by_admin_id
        WHERE v.order_id = ? ORDER BY v.version_no DESC
        """, this::mapVersion, orderId)) : List.of();
    List<OperationView> operations = includeHistory ? jdbc.query("""
        SELECT o.operation_type, o.source, COALESCE(o.actor_identity_snapshot,u.display_name) admin_name, o.order_version_no, o.reason, o.occurred_at
        FROM order_operation o LEFT JOIN admin_user u ON u.id = o.admin_user_id
        WHERE o.order_id = ? ORDER BY o.occurred_at DESC, o.id DESC
        """, this::mapOperation, orderId) : List.of();
    return new OrderView(base.id(), base.activityId(), base.activityCustomerId(), base.orderNo(), base.status(),
        base.createdSource(), base.lastModifiedSource(), base.lockVersion(), base.customerType(), base.regionCode(),
        base.branchName(), base.dealerShortName(), base.dealerFullName(), base.phoneMasked(), base.currentVersion(),
        base.totalQuantity(), base.totalTons(), base.totalAmount(), base.firstSubmittedAt(), base.lastSubmittedAt(),
        base.lastModifiedAt(), base.withdrawnAt(), base.withdrawnReason(), base.voidedAt(), base.voidedReason(),
        itemViews, versions, operations);
  }

  private List<ItemView> assembleSubmittedItems(long orderId, List<CalculatedItem> items) {
    if (items == null || items.isEmpty()) return List.of();
    Map<Integer, Long> lineToId = new HashMap<>();
    jdbc.query("SELECT id, line_no FROM order_item WHERE order_id = ? ORDER BY line_no", rs -> {
      lineToId.put(rs.getInt("line_no"), rs.getLong("id"));
    }, orderId);
    return items.stream().map(item -> {
      long id = lineToId.getOrDefault(item.lineNo(), 0L);
      var p = item.product();
      var pricing = item.pricing();
      return new ItemView(id, p.id(), item.lineNo(), p.materialCode(), p.materialName(),
          p.productLine(), p.specification(), p.casePack(), item.quantity(),
          pricing.casePriceSnapshot(), pricing.appliedTierMinQuantity(),
          pricing.baseCasePrice(), pricing.baseQuantity(), pricing.tierCasePrice(),
          pricing.tierMinQuantity(), pricing.tierQuantity(), pricing.pricingMode(),
          pricing.lineAmount(), p.tonCaseFactor(), item.lineTons(), pricing.pricingDetails());
    }).toList();
  }

  private OrderView withOrderDetails(OrderView order, boolean includeHistory) {
    long orderId = order.id();
    List<ItemView> items = jdbc.query("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no", this::mapItem, orderId);
    List<OrderVersionView> versions = includeHistory ? projectCurrentVersion(order.currentVersion(), withVersionItems(jdbc.query("""
        SELECT v.*, COALESCE(v.actor_identity_snapshot,u.display_name) submitted_by_admin_name FROM order_version v
        LEFT JOIN admin_user u ON u.id = v.submitted_by_admin_id
        WHERE v.order_id = ? ORDER BY v.version_no DESC
        """, this::mapVersion, orderId)), items) : List.of();
    List<OperationView> operations = includeHistory ? jdbc.query("""
        SELECT o.operation_type, o.source, COALESCE(o.actor_identity_snapshot,u.display_name) admin_name, o.order_version_no, o.reason, o.occurred_at
        FROM order_operation o LEFT JOIN admin_user u ON u.id = o.admin_user_id
        WHERE o.order_id = ? ORDER BY o.occurred_at DESC, o.id DESC
        """, this::mapOperation, orderId) : List.of();
    return new OrderView(order.id(), order.activityId(), order.activityCustomerId(), order.orderNo(), order.status(),
        order.createdSource(), order.lastModifiedSource(), order.lockVersion(), order.customerType(), order.regionCode(),
        order.branchName(), order.dealerShortName(), order.dealerFullName(), order.phoneMasked(), order.currentVersion(),
        order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(),
        order.lastModifiedAt(), order.withdrawnAt(), order.withdrawnReason(), order.voidedAt(), order.voidedReason(),
        items, versions, operations);
  }

  AdminOrderView adminView(OrderView order) {
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

  private void requireOrderAccess(long activityId, long orderId) {
    if (jdbc.queryForList("SELECT id FROM customer_order WHERE activity_id=? AND id=?", Long.class, activityId, orderId).isEmpty()) {
      throw DomainException.notFound("ORDER_NOT_FOUND", "订单不存在");
    }
  }

  List<OrderVersionView> withVersionItems(List<OrderVersionView> versions) {
    if (versions.isEmpty()) return versions;
    Map<Long, List<ItemView>> byVersion = new HashMap<>();
    for (int start = 0; start < versions.size(); start += 500) {
      List<OrderVersionView> batch = versions.subList(start, Math.min(start + 500, versions.size()));
      String placeholders = batch.stream().map(v -> "?").collect(Collectors.joining(","));
      jdbc.query("SELECT * FROM order_version_item WHERE order_version_id IN (" + placeholders + ") ORDER BY order_version_id,line_no",
          (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
            byVersion.computeIfAbsent(rs.getLong("order_version_id"), ignored -> new ArrayList<>()).add(mapVersionItem(rs, 0));
          }, batch.stream().map(OrderVersionView::id).toArray());
    }
    return versions.stream().map(v -> new OrderVersionView(v.id(), v.version(), v.totalQuantity(), v.totalTons(), v.totalAmount(),
        v.submittedAt(), v.submittedSource(), v.submittedByAdminName(), v.reason(), List.copyOf(byVersion.getOrDefault(v.id(), List.of())))).toList();
  }

  /** Frozen lines override live lines of the same still-current submission. Older versions never project live rows. */
  List<OrderVersionView> withCurrentVersionItems(long orderId, int currentVersion, List<OrderVersionView> versions) {
    List<OrderVersionView> loaded = withVersionItems(versions);
    boolean projectCurrent = loaded.stream().anyMatch(version -> version.version() == currentVersion);
    if (!projectCurrent) return loaded;
    List<ItemView> currentItems = jdbc.query(
        "SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no", this::mapItem, orderId);
    return projectCurrentVersion(currentVersion, loaded, currentItems);
  }

  private List<OrderVersionView> projectCurrentVersion(int currentVersion, List<OrderVersionView> versions, List<ItemView> currentItems) {
    return versions.stream().map(version -> {
      if (version.version() != currentVersion) return version;
      var lines = new java.util.TreeMap<Integer, ItemView>();
      currentItems.forEach(item -> lines.put(item.lineNo(), item));
      version.items().forEach(item -> lines.put(item.lineNo(), item));
      return new OrderVersionView(version.id(), version.version(), version.totalQuantity(), version.totalTons(), version.totalAmount(),
          version.submittedAt(), version.submittedSource(), version.submittedByAdminName(), version.reason(), List.copyOf(lines.values()));
    }).toList();
  }

  IdempotencyResult beginIdempotency(long activityId, long actorId, String endpoint, String key, byte[] hash) {
    return beginIdempotency(activityId, "H5_CUSTOMER", actorId, endpoint, key, hash);
  }

  boolean matchesH5Receipt(long activityId, long customerId, String endpoint, String key, byte[] fingerprint, byte[] legacyHash) {
    var rows = jdbc.queryForList("""
        SELECT request_hash, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.format')),'1') receipt_format
        FROM api_idempotency WHERE activity_id=? AND actor_type='H5_CUSTOMER' AND actor_id=?
          AND endpoint_code=? AND idempotency_key=?
        """, activityId, customerId, endpoint, key);
    if (rows.isEmpty()) return false;
    byte[] expected = "ORDER_SUBMIT".equals(endpoint) && "2".equals(String.valueOf(rows.getFirst().get("receipt_format")))
        ? fingerprint : legacyHash;
    if (!MessageDigest.isEqual((byte[]) rows.getFirst().get("request_hash"), expected))
      throw DomainException.conflict("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求");
    return true;
  }

  /** Caller holds the activity/customer locks in the order shared by all order writers. */
  OrderView beginH5Submission(long activityId, long customerId, String key, byte[] fingerprint, byte[] legacyHash,
                             boolean includeHistory) {
    if (key == null || key.isBlank() || key.length() > 128)
      throw DomainException.badRequest("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key");
    int inserted = jdbc.update("""
        INSERT IGNORE INTO api_idempotency(activity_id,actor_type,actor_id,endpoint_code,idempotency_key,
          request_hash,status,response_json,expires_at)
        SELECT id,'H5_CUSTOMER',?,'ORDER_SUBMIT',?,?,'PROCESSING',JSON_OBJECT('format',2),
          DATE_ADD(GREATEST(UTC_TIMESTAMP(3),COALESCE(event_ends_at,ends_at)), INTERVAL 30 DAY)
        FROM activity WHERE id=?
        """, customerId,key,fingerprint,activityId);
    if (inserted == 1) return null;
    var rows = jdbc.queryForList("""
        SELECT request_hash,status,response_json FROM api_idempotency
        WHERE activity_id=? AND actor_type='H5_CUSTOMER' AND actor_id=?
          AND endpoint_code='ORDER_SUBMIT' AND idempotency_key=? FOR UPDATE
        """, activityId,customerId,key);
    if (rows.size() != 1) throw new IllegalStateException("Missing idempotency row");
    var row = rows.getFirst();
    try {
      var saved = json.readTree(row.get("response_json") == null ? "{}" : row.get("response_json").toString());
      boolean modern = saved.path("format").asInt() == 2;
      if (!MessageDigest.isEqual((byte[]) row.get("request_hash"), modern ? fingerprint : legacyHash))
        throw DomainException.conflict("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求");
      if (!"COMPLETED".equals(row.get("status")))
        throw DomainException.conflict("REQUEST_IN_PROGRESS", "相同请求正在处理中，请稍后重试");
      // Both compact receipts and older format-2 snapshots identify the completed
      // command, not the order state to display. Re-read without re-executing it.
      // Old snapshots lack includeHistory; the already-validated request carries
      // the response mode (it is part of the format-2 fingerprint).
      if (modern && saved.hasNonNull("orderId"))
        return order(saved.get("orderId").asLong(), includeHistory);
      throw DomainException.conflict("IDEMPOTENCY_RESULT_UNAVAILABLE", "此前提交已成功，请加载最新订单核对");
    } catch (java.io.IOException error) { throw new IllegalStateException("Invalid submission snapshot",error); }
  }

  void completeH5Submission(long activityId, long customerId, String key, OrderView result, boolean includeHistory) {
    try {
      String snapshot = json.writeValueAsString(Map.of("format", 2, "orderId", result.id(),
          "orderVersion", result.currentVersion(), "includeHistory", includeHistory));
      int changed = jdbc.update("""
          UPDATE api_idempotency SET status='COMPLETED',http_status=200,resource_type='ORDER',
            resource_id=?,response_json=?,completed_at=UTC_TIMESTAMP(3)
          WHERE activity_id=? AND actor_type='H5_CUSTOMER' AND actor_id=?
            AND endpoint_code='ORDER_SUBMIT' AND idempotency_key=? AND status='PROCESSING'
          """,result.id(),snapshot,activityId,customerId,key);
      if (changed != 1) throw new IllegalStateException("Submission result was not saved");
    } catch (java.io.IOException error) { throw new IllegalStateException("Cannot save submission snapshot",error); }
  }

  void cancelH5Submission(long activityId, long customerId, String key) {
    jdbc.update("DELETE FROM api_idempotency WHERE activity_id = ? AND actor_type = 'H5_CUSTOMER' AND actor_id = ? AND endpoint_code = 'ORDER_SUBMIT' AND idempotency_key = ? AND status = 'PROCESSING'",
        activityId, customerId, key);
  }

  IdempotencyResult beginIdempotency(long activityId, String actorType, long actorId, String endpoint,
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

  void completeIdempotency(long activityId, long actorId, String endpoint, String key, long orderId) {
    completeIdempotency(activityId, "H5_CUSTOMER", actorId, endpoint, key, orderId);
  }

  void completeIdempotency(long activityId, String actorType, long actorId, String endpoint, String key, long orderId) {
    jdbc.update("""
        UPDATE api_idempotency SET status = 'COMPLETED', http_status = 200, resource_type = 'ORDER', resource_id = ?,
          response_json = JSON_OBJECT('orderId', ?), completed_at = UTC_TIMESTAMP(3)
        WHERE activity_id = ? AND actor_type = ? AND actor_id = ? AND endpoint_code = ? AND idempotency_key = ?
        """, orderId, orderId, activityId, actorType, actorId, endpoint, key);
  }

  void writeOutbox(long activityId, long orderId, String event, Object payload) {
    try {
      jdbc.update("""
          INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
          VALUES (?, 'ORDER', ?, ?, ?, UTC_TIMESTAMP(3))
          """, activityId, Long.toString(orderId), event, json.writeValueAsString(payload));
    } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  static String orderNo(long activityId) { return orderNo(UUID.randomUUID()); }

  // Preserve all UUID bits. Base36 keeps the global public identifier within 27 characters.
  // Existing order numbers are never rewritten; activity ownership remains in its own column.
  static String orderNo(UUID uuid) {
    return "ZY" + new BigInteger(uuid.toString().replace("-", ""),16).toString(36).toUpperCase(Locale.ROOT);
  }

  static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", ""); }

  private List<Step> readProductTiers(ResultSet rs) throws SQLException {
    String value;
    try { value = rs.getString("price_tiers"); }
    catch (SQLException absentLegacyColumn) {
      Long min = nullableLong(rs, "price_tier_min_quantity");
      return min == null ? List.of() : List.of(new Step(min, rs.getBigDecimal("price_tier_case_price")));
    }
    if (value == null) return List.of();
    try {
      var values = json.readValue(value, new com.fasterxml.jackson.core.type.TypeReference<List<Step>>() {});
      return values.stream().sorted(java.util.Comparator.comparingLong(Step::minQuantity)).toList();
    } catch (com.fasterxml.jackson.core.JsonProcessingException exception) { throw new IllegalStateException("Invalid product tiers", exception); }
  }

  ProductSnapshot mapProduct(ResultSet rs, int rowNum) throws SQLException { return new ProductSnapshot(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"), rs.getString("specification"), rs.getString("case_pack"), rs.getString("customer_type"), rs.getString("rebate_status"), rs.getBoolean("is_gift_box"), rs.getBigDecimal("case_price"), rs.getBigDecimal("ton_case_factor"), rs.getString("image_key"), nullableLong(rs, "price_tier_min_quantity"), rs.getBigDecimal("price_tier_case_price"), rs.getString("price_tier_pricing_mode"), readProductTiers(rs)); }

  OrderView mapOrder(ResultSet rs, int rowNum) throws SQLException { return new OrderView(rs.getLong("id"), rs.getLong("activity_id"), rs.getLong("activity_customer_id"), rs.getString("order_no"), rs.getString("status"), rs.getString("created_source"), rs.getString("last_modified_source"), rs.getInt("lock_version"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_short_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), UtcTime.read(rs, "first_submitted_at"), UtcTime.read(rs, "last_submitted_at"), UtcTime.read(rs, "last_modified_at"), instant(rs, "withdrawn_at"), rs.getString("withdrawn_reason"), instant(rs, "voided_at"), rs.getString("voided_reason"), List.of(), List.of(), List.of()); }

  ItemView mapItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }

  ItemView mapVersionItem(ResultSet rs, int rowNum) throws SQLException { return item(rs, "id", "activity_product_id"); }

  ItemView item(ResultSet rs, String idColumn, String productColumn) throws SQLException { return new ItemView(rs.getLong(idColumn), rs.getObject(productColumn) == null ? null : rs.getLong(productColumn), rs.getInt("line_no"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("product_line"), rs.getString("specification"), rs.getString("case_pack"), rs.getLong("quantity"), rs.getBigDecimal("case_price"), nullableLong(rs, "applied_tier_min_quantity"), rs.getBigDecimal("base_case_price"), nullableLong(rs, "base_price_quantity"), rs.getBigDecimal("tier_case_price"), nullableLong(rs, "tier_min_quantity"), nullableLong(rs, "tier_price_quantity"), rs.getString("pricing_mode"), rs.getBigDecimal("line_amount"), rs.getBigDecimal("ton_case_factor"), rs.getBigDecimal("line_tons"), TierPricing.decode(rs.getString("pricing_details"))); }


  OrderVersionView mapVersion(ResultSet rs, int rowNum) throws SQLException { return new OrderVersionView(rs.getLong("id"), rs.getInt("version_no"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), UtcTime.read(rs, "submitted_at"), rs.getString("submitted_source"), rs.getString("submitted_by_admin_name"), rs.getString("reason"), List.of()); }

  OperationView mapOperation(ResultSet rs, int rowNum) throws SQLException { return new OperationView(rs.getString("operation_type"), rs.getString("source"), rs.getString("admin_name"), rs.getObject("order_version_no") == null ? null : rs.getInt("order_version_no"), rs.getString("reason"), UtcTime.read(rs, "occurred_at")); }

  static Long nullableLong(ResultSet rs, String column) throws SQLException { long value = rs.getLong(column); return rs.wasNull() ? null : value; }

  static Instant instant(ResultSet rs, String column) throws SQLException { return UtcTime.read(rs, column); }

  long insertH5Order(long activityId, H5Principal customer, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount) {
      String orderNo = orderNo(activityId);
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
        int i = 0; ps.setLong(++i, activityId); ps.setLong(++i, customer.customerId()); ps.setString(++i, orderNo);
        ps.setString(++i, customer.customerType()); ps.setString(++i, customer.regionCode()); ps.setString(++i, customer.branchName());
        ps.setString(++i, customer.dealerShortName()); ps.setString(++i, customer.dealerFullName()); ps.setLong(++i, finalTotalQuantity);
        ps.setBigDecimal(++i, finalTotalTons); ps.setBigDecimal(++i, finalTotalAmount); return ps;
      }, keys);
      return keys.getKey().longValue();
  }

  int updateH5Order(int nextVersion, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, OrderRow current, int currentVersion) {
    return jdbc.update("""
          UPDATE customer_order SET status = 'SUBMITTED', current_version_no = ?, total_quantity = ?, total_tons = ?,
            total_amount = ?, last_submitted_at = UTC_TIMESTAMP(3), last_modified_at = UTC_TIMESTAMP(3), withdrawn_at = NULL,
            withdrawn_reason = NULL, voided_at = NULL, voided_reason = NULL, voided_by_admin_id = NULL,
            last_modified_source = 'H5', last_modified_admin_id = NULL, lock_version = lock_version + 1
          WHERE id = ? AND current_version_no = ? AND lock_version = ?
          """, nextVersion, totalQuantity, totalTons, totalAmount, current.id(), currentVersion, current.lockVersion());
  }

  void insertH5Submission(long activityId, long orderId, String operation, int nextVersion, String traceId) {
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, order_version_no, trace_id, occurred_at)
        VALUES (?, ?, ?, 'H5', ?, ?, UTC_TIMESTAMP(3))
        """, activityId, orderId, operation, nextVersion, traceId);
  }

  int withdrawOrder(OrderRow order, int expectedVersion) {
    return jdbc.update("""
        UPDATE customer_order SET status = 'WITHDRAWN', withdrawn_at = UTC_TIMESTAMP(3), withdrawn_reason = '客户主动撤回',
          last_modified_at = UTC_TIMESTAMP(3), last_modified_source = 'H5', lock_version = lock_version + 1
        WHERE id = ? AND status = 'SUBMITTED' AND current_version_no = ? AND lock_version = ?
        """, order.id(), expectedVersion, order.lockVersion());
  }

  int withdrawOrderByAdmin(long activityId, long orderId, OrderRow order, String reason, long adminId) {
    return jdbc.update("""
        UPDATE customer_order SET status = 'WITHDRAWN', withdrawn_at = UTC_TIMESTAMP(3), withdrawn_reason = ?,
          last_modified_at = UTC_TIMESTAMP(3), last_modified_source = 'ADMIN', last_modified_admin_id = ?, lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND status = 'SUBMITTED' AND current_version_no = ? AND lock_version = ?
        """, reason, adminId, orderId, activityId, order.version(), order.lockVersion());
  }

  void insertH5Withdrawal(long activityId, long orderId, int expectedVersion, String traceId) {
    jdbc.update("""
        INSERT INTO order_operation(activity_id, order_id, operation_type, source, order_version_no, reason, trace_id, occurred_at)
        VALUES (?, ?, 'WITHDRAW', 'H5', ?, '客户主动撤回', ?, UTC_TIMESTAMP(3))
        """, activityId, orderId, expectedVersion, traceId);
  }

  int adjustOrder(long activityId, long orderId, OrderRow current, int nextVersion, CalculatedOrder calculated, long adminId) {
    return jdbc.update("""
        UPDATE customer_order SET status = 'SUBMITTED', current_version_no = ?, total_quantity = ?, total_tons = ?,
          total_amount = ?, last_modified_at = UTC_TIMESTAMP(3), withdrawn_at = NULL, withdrawn_reason = NULL,
          voided_at = NULL, voided_reason = NULL, voided_by_admin_id = NULL,
          last_modified_source = 'ADMIN', last_modified_admin_id = ?, lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND current_version_no = ? AND lock_version = ?
        """, nextVersion, calculated.totalQuantity(), calculated.totalTons(), calculated.totalAmount(), adminId,
        orderId, activityId, current.version(), current.lockVersion());
  }

  int voidOrder(long activityId, long orderId, OrderRow current, String reason, long adminId) {
    return jdbc.update("""
          UPDATE customer_order SET status = 'VOIDED', voided_at = UTC_TIMESTAMP(3), voided_reason = ?,
            voided_by_admin_id = ?, last_modified_at = UTC_TIMESTAMP(3), last_modified_source = 'ADMIN',
            last_modified_admin_id = ?, lock_version = lock_version + 1
          WHERE id = ? AND activity_id = ? AND current_version_no = ? AND lock_version = ?
          """, reason, adminId, adminId, orderId, activityId, current.version(), current.lockVersion());
  }

  void deleteCurrentItems(long orderId) { jdbc.update("DELETE FROM order_item WHERE order_id = ?", orderId); }
  Map<String, Object> currentItem(long orderId, long productId) { return jdbc.queryForMap("SELECT * FROM order_item WHERE order_id=? AND activity_product_id=?", orderId, productId); }
}
