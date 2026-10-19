package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.UtcTime;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class OrderChangeRequestRepository {
  private final JdbcTemplate jdbc;

  public OrderChangeRequestRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  OrderChangeRequestRow pendingForCustomer(long activityId, long customerId) {
    return jdbc.query(baseSelect() + " WHERE r.activity_id = ? AND r.activity_customer_id = ? ORDER BY r.id DESC LIMIT 1",
        this::map, activityId, customerId).stream().findFirst().orElse(null);
  }

  OrderChangeRequestRow byIdForUpdate(long activityId, long requestId) {
    return jdbc.query(baseSelect() + " WHERE r.activity_id = ? AND r.id = ? FOR UPDATE",
        this::map, activityId, requestId).stream().findFirst().orElse(null);
  }

  OrderChangeRequestRow byIdempotency(long activityId, long customerId, String key) {
    return jdbc.query(baseSelect() + " WHERE r.activity_id = ? AND r.activity_customer_id = ? AND r.idempotency_key = ?",
        this::map, activityId, customerId, key).stream().findFirst().orElse(null);
  }

  List<OrderChangeRequestRow> list(long activityId, String status, int limit) {
    String effectiveStatus = status == null || status.isBlank() ? "PENDING" : status.trim().toUpperCase();
    return jdbc.query(baseSelect() + " WHERE r.activity_id = ? AND r.status = ? ORDER BY r.requested_at ASC, r.id ASC LIMIT ?",
        this::map, activityId, effectiveStatus, Math.min(Math.max(limit, 1), 200));
  }

  boolean pendingForOrder(long orderId) {
    Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM order_change_request WHERE order_id = ? AND status = 'PENDING'", Integer.class, orderId);
    return count != null && count > 0;
  }

  long insert(long activityId, long orderId, long customerId, String requestType, int baseVersion, int baseLockVersion,
              Long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount, String itemsJson, String customerNote,
              String idempotencyKey) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var statement = connection.prepareStatement("""
          INSERT INTO order_change_request(activity_id, order_id, activity_customer_id, request_type, status,
            base_order_version, base_lock_version, requested_total_quantity, requested_total_tons, requested_total_amount,
            requested_items_json, customer_note, idempotency_key)
          VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int i = 0;
      statement.setLong(++i, activityId);
      statement.setLong(++i, orderId);
      statement.setLong(++i, customerId);
      statement.setString(++i, requestType);
      statement.setInt(++i, baseVersion);
      statement.setInt(++i, baseLockVersion);
      if (totalQuantity == null) statement.setNull(++i, java.sql.Types.BIGINT); else statement.setLong(++i, totalQuantity);
      statement.setBigDecimal(++i, totalTons);
      statement.setBigDecimal(++i, totalAmount);
      statement.setString(++i, itemsJson);
      statement.setString(++i, customerNote);
      statement.setString(++i, idempotencyKey);
      return statement;
    }, keys);
    return keys.getKey().longValue();
  }

  void review(long requestId, String status, String reason, long adminId) {
    jdbc.update("""
        UPDATE order_change_request SET status = ?, review_reason = ?, reviewed_by_admin_id = ?, reviewed_at = UTC_TIMESTAMP(3),
          reviewer_identity_snapshot = (SELECT CONCAT(display_name,'（',username,'）') FROM admin_user WHERE id=?)
        WHERE id = ? AND status = 'PENDING'
        """, status, reason, adminId, adminId, requestId);
  }

  void conflict(long requestId, String reason) {
    jdbc.update("INSERT INTO order_operation(activity_id,order_id,operation_type,source,order_version_no,reason,occurred_at) SELECT activity_id,order_id,'H5_CHANGE_REJECTED','SYSTEM',base_order_version,?,UTC_TIMESTAMP(3) FROM order_change_request WHERE id=? AND status='PENDING'",reason,requestId);
    jdbc.update("""
        UPDATE order_change_request SET status = 'REJECTED', review_reason = ?, reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND status = 'PENDING'
        """, reason, requestId);
  }

  private String baseSelect() {
    return """
        SELECT r.*, o.order_no, o.status order_status, o.current_version_no current_version, o.lock_version current_lock_version,
          o.total_quantity current_total_quantity, o.total_tons current_total_tons, o.total_amount current_total_amount,
          o.dealer_full_name_snapshot dealer_name, c.phone_masked, COALESCE(r.reviewer_identity_snapshot,u.display_name) reviewed_by_name
        FROM order_change_request r
        JOIN customer_order o ON o.id = r.order_id
        JOIN activity_customer c ON c.id = r.activity_customer_id
        LEFT JOIN admin_user u ON u.id = r.reviewed_by_admin_id
        """;
  }

  void rejectPending(long orderId, String reason) {
    jdbc.update("INSERT INTO order_operation(activity_id,order_id,operation_type,source,order_version_no,reason,occurred_at) SELECT activity_id,order_id,'H5_CHANGE_REJECTED','SYSTEM',base_order_version,?,UTC_TIMESTAMP(3) FROM order_change_request WHERE order_id=? AND status='PENDING'",reason,orderId);
    jdbc.update("UPDATE order_change_request SET status='REJECTED',review_reason=?,reviewed_at=UTC_TIMESTAMP(3) WHERE order_id=? AND status='PENDING'", reason, orderId);
  }

  OrderChangeRequestRow detail(long activityId, long requestId) {
    return jdbc.query(baseSelect()+" WHERE r.activity_id=? AND r.id=?",this::map,activityId,requestId).stream().findFirst().orElse(null);
  }

  void saveOriginal(long requestId, String snapshot) {
    jdbc.update("UPDATE order_change_request SET original_order_json=CAST(? AS JSON) WHERE id=?",snapshot,requestId);
  }

  List<java.util.Map<String,Object>> pending(long activityId) {
    return jdbc.queryForList("SELECT id,order_id AS orderId FROM order_change_request WHERE activity_id=? AND status='PENDING'",activityId);
  }

  com.fengyi.ordershow.common.PageResponse<java.util.Map<String,Object>> page(long activityId, String status, String type, String keyword, int page, int size, boolean newest, String traceId) {
    String where=" FROM order_change_request r JOIN customer_order o ON o.id=r.order_id JOIN activity_customer c ON c.id=r.activity_customer_id WHERE r.activity_id=?";
    var args=new java.util.ArrayList<Object>(); args.add(activityId);
    if (!"ALL".equals(status)) { where+=" AND r.status=?"; args.add(status); }
    if (!"ALL".equals(type)) { where+=" AND r.request_type=?"; args.add(type); }
    if (keyword!=null && !keyword.isBlank()) {
      where+=" AND (LOCATE(?,o.order_no)>0 OR LOCATE(?,o.dealer_full_name_snapshot)>0 OR LOCATE(?,c.phone)>0)";
      for(int i=0;i<3;i++) args.add(keyword.trim());
    }
    long total=jdbc.queryForObject("SELECT COUNT(*)"+where,Long.class,args.toArray());
    args.add(size);args.add((page-1)*size);
    var rows=jdbc.queryForList("SELECT r.id,r.order_id AS orderId,o.order_no AS orderNo,o.dealer_full_name_snapshot AS dealerName,c.phone,r.request_type AS requestType,r.status,r.base_order_version AS baseVersion,o.current_version_no AS currentVersion,o.total_amount AS currentTotalAmount,r.requested_total_amount AS requestedTotalAmount,r.requested_total_quantity AS requestedTotalQuantity,r.requested_total_tons AS requestedTotalTons,JSON_LENGTH(r.requested_items_json) AS itemCount,r.requested_at AS requestedAt,r.review_reason AS reviewReason"+where+" ORDER BY r.requested_at "+(newest?"DESC":"ASC")+",r.id "+(newest?"DESC":"ASC")+" LIMIT ? OFFSET ?",args.toArray());
    return com.fengyi.ordershow.common.PageResponse.of(rows,page,size,total,traceId);
  }

  private OrderChangeRequestRow map(ResultSet rs, int rowNum) throws SQLException {
    return new OrderChangeRequestRow(
        rs.getLong("id"), rs.getLong("activity_id"), rs.getLong("order_id"), rs.getLong("activity_customer_id"),
        rs.getString("order_no"), rs.getString("dealer_name"), rs.getString("phone_masked"),
        rs.getString("request_type"), rs.getString("status"), rs.getInt("base_order_version"), rs.getInt("base_lock_version"),
        rs.getInt("current_version"), rs.getInt("current_lock_version"), rs.getString("order_status"),
        rs.getLong("current_total_quantity"), rs.getBigDecimal("current_total_tons"), rs.getBigDecimal("current_total_amount"),
        nullableLong(rs, "requested_total_quantity"), rs.getBigDecimal("requested_total_tons"), rs.getBigDecimal("requested_total_amount"),
        rs.getString("requested_items_json"), rs.getString("customer_note"), rs.getString("review_reason"),
        nullableLong(rs, "reviewed_by_admin_id"), rs.getString("reviewed_by_name"),
        UtcTime.read(rs, "requested_at"), timestamp(rs, "reviewed_at"), rs.getString("original_order_json"));
  }

  private static Long nullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  private static Instant timestamp(ResultSet rs, String column) throws SQLException {
    return UtcTime.read(rs, column);
  }
}

record OrderChangeRequestRow(
    long id, long activityId, long orderId, long customerId, String orderNo, String dealerName, String phoneMasked,
    String requestType, String status, int baseVersion, int baseLockVersion, int currentVersion, int currentLockVersion,
    String orderStatus, long currentTotalQuantity, BigDecimal currentTotalTons, BigDecimal currentTotalAmount,
    Long requestedTotalQuantity, BigDecimal requestedTotalTons, BigDecimal requestedTotalAmount, String requestedItemsJson,
    String customerNote, String reviewReason, Long reviewedByAdminId, String reviewedByName, Instant requestedAt, Instant reviewedAt, String originalOrderJson) {}
