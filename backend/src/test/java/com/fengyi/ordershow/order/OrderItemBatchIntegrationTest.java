package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static com.fengyi.ordershow.order.OrderData.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_LOAD", matches="order-show-load")
class OrderItemBatchIntegrationTest {
  private CalculatedItem item(int line, boolean invalid) {
    var product = new ProductSnapshot(100L + line, "M", invalid ? null : "商品", "C", "P", "B", "V", "S", "12",
        "SPECIAL", "ALL", false, new BigDecimal("100"), new BigDecimal("20"), null, 2L, new BigDecimal("80"), "INCREMENTAL");
    return new CalculatedItem(line, product, 3, OrderPricingCalculator.calculatePrice(product.casePrice(),
        product.priceTierMinQuantity(), product.priceTierCasePrice(), product.priceTierPricingMode(), 3), new BigDecimal("0.15"));
  }

  @Test void actualMysqlRewritesBatchesAndPreservesSnapshots() { verifyBatch(false); }
  @Test void laterChunkFailureRollsBackBothCurrentAndHistory() { verifyBatch(true); }

  private void verifyBatch(boolean fail) {
    // Connection-local temporary tables shadow real names; real fixture rows are never modified.
    try (var source = new SingleConnectionDataSource(
        "jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true",
        "order_show_load", "load_only_password", true)) {
      var jdbc = new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_load");
      jdbc.execute("CREATE TEMPORARY TABLE batch_current_template LIKE order_show_load.order_item");
      jdbc.execute("CREATE TEMPORARY TABLE batch_history_template LIKE order_show_load.order_version_item");
      jdbc.execute("CREATE TEMPORARY TABLE order_item LIKE batch_current_template");
      jdbc.execute("CREATE TEMPORARY TABLE order_version_item LIKE batch_history_template");
      var repository = new OrderRepository(jdbc, new ObjectMapper());
      var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
      Runnable write = () -> transaction.executeWithoutResult(status -> {
        repository.insertCurrentItems(7, IntStream.rangeClosed(1,201).mapToObj(n -> item(n,false)).toList());
        repository.insertVersionItems(9, IntStream.rangeClosed(1,201).mapToObj(n -> item(n,fail && n==101)).toList());
      });
      if (fail) assertThatThrownBy(write::run).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
      else write.run();
      for (String table : new String[]{"order_item", "order_version_item"}) {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class)).isEqualTo(fail ? 0 : 201);
        if (!fail) {
          assertThat(jdbc.queryForObject("SELECT SUM(line_amount) FROM " + table, BigDecimal.class)).isEqualByComparingTo("52260");
          assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE pricing_mode='INCREMENTAL' AND quantity=3 AND base_price_quantity=1 AND tier_price_quantity=2 AND line_tons=0.15 AND primary_image_object_key IS NULL", Integer.class)).isEqualTo(201);
        }
      }
    }
  }
}
