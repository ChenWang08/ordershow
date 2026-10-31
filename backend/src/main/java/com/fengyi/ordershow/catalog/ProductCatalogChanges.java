package com.fengyi.ordershow.catalog;

import java.util.Collection;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** A durable description of committed changes, not a browser invalidation or an order event. */
public final class ProductCatalogChanges {
  public static final String EVENT_TYPE = "PRODUCT_CATALOG_CHANGED";
  public static final int MAX_PRODUCT_IDS = 500;

  private ProductCatalogChanges() {}

  public static void products(JdbcTemplate jdbc, long activityId, Collection<Long> productIds) {
    record(jdbc, activityId, productIds, false);
  }

  public static void all(JdbcTemplate jdbc, long activityId) { record(jdbc, activityId, List.of(), true); }

  private static void record(JdbcTemplate jdbc, long activityId, Collection<Long> productIds, boolean full) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("Catalog changes must share the business transaction");
    }
    var ids = productIds.stream().distinct().sorted().toList();
    full |= ids.size() > MAX_PRODUCT_IDS;
    String encodedIds = full ? "[]" : ids.toString(); // Numeric IDs only, never request text.
    jdbc.update("UPDATE activity SET product_catalog_version = product_catalog_version + 1 WHERE id = ?", activityId);
    jdbc.update("""
        INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
        SELECT id, 'PRODUCT_CATALOG', CAST(id AS CHAR), 'PRODUCT_CATALOG_CHANGED',
          JSON_OBJECT('version', CAST(product_catalog_version AS CHAR), 'productIds', CAST(? AS JSON),
            'fullReload', CAST(? AS JSON)), UTC_TIMESTAMP(3)
        FROM activity WHERE id = ?
        """, encodedIds, full ? "true" : "false", activityId);
  }
}
