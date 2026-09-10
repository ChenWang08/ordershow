package com.fengyi.ordershow.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.ProductCatalogReader;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.order.OrderService;
import com.fengyi.ordershow.security.H5Principal;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Read-only preparation before Spring publishes ACCEPTING_TRAFFIC; never creates test orders/sessions. */
@Component
@Order(300)
public class H5StartupWarmup implements ApplicationRunner {
  private final JdbcTemplate jdbc;
  private final ProductCatalogReader catalog;
  private final OrderService orders;
  private final ObjectMapper json;
  private final TransactionTemplate reads;
  private final boolean enabled;

  public H5StartupWarmup(JdbcTemplate jdbc, ProductCatalogReader catalog, OrderService orders, ObjectMapper json,
      PlatformTransactionManager manager, @Value("${H5_WARMUP_ENABLED:true}") boolean enabled) {
    this.jdbc = jdbc; this.catalog = catalog; this.orders = orders; this.json = json; this.enabled = enabled;
    reads = new TransactionTemplate(manager); reads.setReadOnly(true); reads.setTimeout(3);
  }

  @Override public void run(ApplicationArguments arguments) {
    if (!enabled) return;
    long started = System.nanoTime();
    var customers = reads.execute(status -> jdbc.query("""
        SELECT c.id,c.activity_id,a.activity_code,c.customer_type,c.region_code,c.branch_name,
          c.dealer_short_name,c.dealer_full_name,c.phone_masked
        FROM activity_customer c JOIN activity a ON a.id=c.activity_id
        JOIN department d ON d.id=a.department_id AND d.status='ACTIVE'
        JOIN activity_data_binding b ON b.activity_id=c.activity_id AND b.data_type='WHITELIST' AND b.current_version_id=c.data_version_id
        LEFT JOIN customer_order o ON o.activity_id=c.activity_id AND o.activity_customer_id=c.id
        WHERE c.is_active=TRUE AND a.archived_at IS NULL AND a.status IN ('SCHEDULED','ACTIVE','CLOSED')
          AND (a.event_ends_at IS NULL OR a.event_ends_at>UTC_TIMESTAMP(3))
        ORDER BY (o.id IS NULL),c.id LIMIT 4
        """, (rs,n) -> new H5Principal(0,rs.getLong("activity_id"),rs.getLong("id"),rs.getString("activity_code"),
            rs.getString("customer_type"),rs.getString("region_code"),rs.getString("branch_name"),
            rs.getString("dealer_short_name"),rs.getString("dealer_full_name"),rs.getString("phone_masked"))));
    int completed = 0;
    warmup: for (int round=0; round<32; round++) {
      for (var customer : customers) {
        if (System.nanoTime()-started > 15_000_000_000L) break warmup;
        reads.executeWithoutResult(status -> {
          try {
            json.writeValueAsBytes(ApiResponse.of(catalog.h5Products(customer.activityCode(),customer,null,null),"startup-warmup"));
            json.writeValueAsBytes(ApiResponse.of(orders.current(customer.activityCode(),customer,false),"startup-warmup"));
          } catch (java.io.IOException failure) { throw new IllegalStateException("H5 warmup serialization failed",failure); }
        });
        completed++;
      }
    }
    LoggerFactory.getLogger(getClass()).info("Read-only H5 warmup complete: samples={}, iterations={}, elapsedMs={}",
        customers.size(),completed,(System.nanoTime()-started)/1_000_000);
  }
}
