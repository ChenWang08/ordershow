package com.fengyi.ordershow.order;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderDraftService {
  private static final TypeReference<List<DraftItem>> DRAFT_ITEMS = new TypeReference<>() {};

  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final ObjectMapper json;

  public OrderDraftService(JdbcTemplate jdbc, ActivityService activities, ObjectMapper json) {
    this.jdbc = jdbc;
    this.activities = activities;
    this.json = json;
  }

  public DraftView current(String activityCode, H5Principal customer) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT id, activity_id, activity_customer_id, base_order_version, items_json, lock_version, updated_at, expires_at
        FROM h5_order_draft
        WHERE activity_id = ? AND activity_customer_id = ? AND expires_at > UTC_TIMESTAMP(3)
        """, activity.id(), customer.customerId());
    return rows.isEmpty() ? null : map(rows.getFirst());
  }

  @Transactional
  public DraftView save(String activityCode, H5Principal customer, SaveDraftRequest request) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    requireOwner(customer, request.customerId());
    activities.requireWritable(activity.id());
    List<DraftItem> items = validateItems(activity.id(), customer, request.items());
    int currentOrderVersion = currentOrderVersion(activity.id(), customer.customerId());
    if (request.baseOrderVersion() != currentOrderVersion) {
      throw DomainException.conflict("DRAFT_BASE_ORDER_VERSION_CONFLICT", "订单已更新，当前草稿不能覆盖最新订单，请重新进入订货页");
    }
    String serialized;
    try { serialized = json.writeValueAsString(items); }
    catch (Exception exception) { throw new IllegalStateException("订单草稿序列化失败", exception); }
    jdbc.update("""
        INSERT INTO h5_order_draft(activity_id, activity_customer_id, base_order_version, items_json, expires_at,
          created_at, updated_at)
        VALUES (?, ?, ?, CAST(? AS JSON), ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE base_order_version = VALUES(base_order_version), items_json = VALUES(items_json),
          expires_at = VALUES(expires_at), lock_version = lock_version + 1, updated_at = UTC_TIMESTAMP(3)
        """, activity.id(), customer.customerId(), request.baseOrderVersion(), serialized, Timestamp.from(activity.endsAt()));
    return current(activityCode, customer);
  }

  @Transactional
  public boolean delete(String activityCode, H5Principal customer, long ownerCustomerId) {
    var activity = activities.byCode(activityCode);
    requireIdentity(activity.id(), customer);
    requireOwner(customer, ownerCustomerId);
    return jdbc.update("DELETE FROM h5_order_draft WHERE activity_id = ? AND activity_customer_id = ?",
        activity.id(), customer.customerId()) > 0;
  }

  private List<DraftItem> validateItems(long activityId, H5Principal customer, List<DraftItem> requested) {
    if (requested == null || requested.isEmpty()) {
      throw DomainException.unprocessable("DRAFT_EMPTY", "空购物车不需要保存草稿");
    }
    if (requested.size() > 1000) throw DomainException.unprocessable("DRAFT_TOO_MANY_ITEMS", "购物车商品种类过多");
    Map<Long, Long> quantities = new LinkedHashMap<>();
    for (DraftItem item : requested) {
      if (item.productId() <= 0 || item.quantity() <= 0 || item.quantity() > 999_999) {
        throw DomainException.unprocessable("DRAFT_ITEM_INVALID", "草稿中的商品和订货箱数必须有效");
      }
      if (quantities.put(item.productId(), item.quantity()) != null) {
        throw DomainException.unprocessable("DRAFT_ITEM_DUPLICATE", "草稿中的同一商品不能重复");
      }
    }
    Set<Long> ids = quantities.keySet();
    String placeholders = ids.stream().map(id -> "?").collect(Collectors.joining(","));
    List<Object> args = new ArrayList<>();
    args.add(activityId); args.add(customer.customerType()); args.add(customer.customerType()); args.add(normalize(customer.branchName())); args.addAll(ids);
    List<Long> validIds = jdbc.queryForList("""
        SELECT p.id FROM activity_product p
        JOIN activity_data_binding b ON b.current_version_id = p.data_version_id
          AND b.activity_id = p.activity_id AND b.data_type = 'PRODUCT'
        WHERE p.activity_id = ? AND (? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL') AND p.is_visible = TRUE AND p.is_orderable = TRUE
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s
                 WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
          AND p.id IN (""" + placeholders + ")", Long.class, args.toArray());
    if (validIds.size() != ids.size()) {
      throw DomainException.unprocessable("DRAFT_PRODUCT_NOT_ORDERABLE", "草稿中包含已失效或不属于当前客户的商品");
    }
    return quantities.entrySet().stream().map(entry -> new DraftItem(entry.getKey(), entry.getValue())).toList();
  }

  private int currentOrderVersion(long activityId, long customerId) {
    List<Integer> versions = jdbc.queryForList("SELECT current_version_no FROM customer_order WHERE activity_id = ? AND activity_customer_id = ?",
        Integer.class, activityId, customerId);
    return versions.isEmpty() ? 0 : versions.getFirst();
  }

  private DraftView map(Map<String, Object> row) {
    try {
      List<DraftItem> items = json.readValue(row.get("items_json").toString(), DRAFT_ITEMS);
      return new DraftView(((Number) row.get("id")).longValue(), ((Number) row.get("activity_id")).longValue(),
          ((Number) row.get("activity_customer_id")).longValue(), ((Number) row.get("base_order_version")).intValue(),
          ((Number) row.get("lock_version")).intValue(), items, toInstant(row.get("updated_at")),
          toInstant(row.get("expires_at")));
    } catch (Exception exception) { throw new IllegalStateException("订单草稿解析失败", exception); }
  }

  private static void requireOwner(H5Principal customer, long ownerCustomerId) {
    if (customer.customerId() != ownerCustomerId) {
      throw DomainException.forbidden("DRAFT_CUSTOMER_MISMATCH", "不能操作其他客户的订单草稿");
    }
  }

  private static void requireIdentity(long activityId, H5Principal customer) {
    if (customer.activityId() != activityId) {
      throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动");
    }
  }

  private static String normalize(String value) {
    return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", "");
  }

  private static Instant toInstant(Object value) {
    if (value instanceof Timestamp timestamp) return timestamp.toInstant();
    if (value instanceof LocalDateTime dateTime) return dateTime.toInstant(ZoneOffset.UTC);
    if (value instanceof Instant instant) return instant;
    throw new IllegalArgumentException("Unsupported database timestamp: " + value);
  }

  public record DraftItem(long productId, long quantity) {}
  public record SaveDraftRequest(long customerId, int baseOrderVersion, List<DraftItem> items) {}
  public record DraftView(long id, long activityId, long customerId, int baseOrderVersion, int version,
                          List<DraftItem> items, Instant updatedAt, Instant expiresAt) {}
}
