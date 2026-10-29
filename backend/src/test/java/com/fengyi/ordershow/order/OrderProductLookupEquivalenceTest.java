package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.ProductDealerScopeService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_H5OPT_FIXTURE", matches="cohort")
class OrderProductLookupEquivalenceTest {
  @Test void joinedTierMatchesOldSubqueriesAndPreservesProductScopes() throws Exception {
    try (var source = new SingleConnectionDataSource(
        "jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false", "root", "load_only_root", true)) {
      var jdbc = new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_load");
      long activity = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code='LOAD-CAP-cohort'", Long.class);
      String schema = "order_show_h5opt_products";
      jdbc.execute("CREATE DATABASE " + schema);
      try {
        jdbc.execute("USE " + schema);
        for (String table : List.of("activity_product", "activity_customer", "activity_data_binding", "activity_product_price_tier", "product_image", "stored_file", "activity_product_branch_scope", "activity_product_dealer_scope", "activity_product_dealer_member")) {
          jdbc.execute("CREATE TABLE " + table + " LIKE order_show_load." + table);
          jdbc.update("INSERT INTO " + table + " SELECT * FROM order_show_load." + table);
        }
        var customer = jdbc.queryForMap("SELECT * FROM activity_customer WHERE activity_id=? AND customer_type='GENERAL' AND is_active=TRUE ORDER BY id LIMIT 1", activity);
        long customerId = ((Number)customer.get("id")).longValue();
        String branch = customer.get("branch_name").toString();
        var ids = new LinkedHashSet<>(jdbc.queryForList("SELECT id FROM activity_product WHERE activity_id=? ORDER BY id", Long.class, activity));
        long first = ids.iterator().next();
        jdbc.update("INSERT INTO activity_product_price_tier(activity_product_id,min_quantity,case_price,pricing_mode) VALUES(?,2,80,'WHOLE_ORDER'),(?,2,80,'INCREMENTAL')",first,first+1);
        var repository = new OrderRepository(jdbc, new ObjectMapper());
        String legacy;
        try (var resource = getClass().getResourceAsStream("/baseline/h5-products.sql")) { legacy = new String(resource.readAllBytes(), StandardCharsets.UTF_8); }
        String sql = legacy + ProductDealerScopeService.ALLOWED_SQL + " AND p.id IN (" + ids.stream().map(id -> "?").collect(Collectors.joining(",")) + ") ORDER BY p.sort_no,p.id";
        var args = new ArrayList<Object>(List.of(activity,"GENERAL","GENERAL",OrderRepository.normalize(branch),customerId)); args.addAll(ids);
        for (int step=0; step<6; step++) {
          switch (step) {
            case 1 -> jdbc.update("UPDATE activity_product SET is_orderable=FALSE WHERE id=?",first+2);
            case 2 -> jdbc.update("UPDATE activity_product SET is_visible=FALSE,is_orderable=FALSE WHERE id=?",first+3);
            case 3 -> jdbc.update("INSERT INTO activity_product_branch_scope(activity_product_id,branch_name,normalized_branch_name) VALUES(?,'Other','other')",first+4);
            case 4 -> jdbc.update("INSERT INTO activity_product_dealer_scope(activity_product_id,branch_name,normalized_branch_name) VALUES(?,?,?)",first+5,branch,customer.get("normalized_branch_name"));
            case 5 -> jdbc.update("INSERT INTO activity_product_dealer_member(activity_product_id,normalized_branch_name,customer_id,customer_type,normalized_dealer_full_name,dealer_full_name) VALUES(?,?,?,'GENERAL',?,?)",first+5,customer.get("normalized_branch_name"),customer.get("customer_id"),customer.get("normalized_dealer_full_name"),customer.get("dealer_full_name"));
          }
          var expected = jdbc.query(sql, repository::mapProduct, args.toArray());
          var actual = repository.loadProducts(activity, customerId, "GENERAL", branch, ids);
          assertThat(actual).isEqualTo(expected);
          assertThat(actual.size()).isEqualTo(new int[]{180,179,178,177,176,177}[step]);
          assertThat(actual.getFirst().priceTierPricingMode()).isEqualTo("WHOLE_ORDER");
          assertThat(actual.get(1).priceTierPricingMode()).isEqualTo("INCREMENTAL");
        }
      } finally { jdbc.execute("USE order_show_load"); jdbc.execute("DROP DATABASE " + schema); }
    }
  }
}
