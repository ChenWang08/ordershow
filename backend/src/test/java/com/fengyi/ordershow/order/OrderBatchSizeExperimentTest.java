package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static com.fengyi.ordershow.order.OrderData.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Opt-in experiment; production batch size changes only if measured benefit is repeatable. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_BATCH_EXPERIMENT", matches="order-show-load")
class OrderBatchSizeExperimentTest {
  @Test void compareBatchSizesWithIdenticalSnapshotRows() {
    try (var source = new SingleConnectionDataSource(
        "jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true",
        "order_show_load", "load_only_password", true)) {
      var jdbc = new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_load");
      jdbc.execute("CREATE TEMPORARY TABLE batch_current_template LIKE order_show_load.order_item");
      jdbc.execute("CREATE TEMPORARY TABLE batch_history_template LIKE order_show_load.order_version_item");
      jdbc.execute("CREATE TEMPORARY TABLE order_item LIKE batch_current_template");
      jdbc.execute("CREATE TEMPORARY TABLE order_version_item LIKE batch_history_template");
      var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
      for (int size : new int[]{41, 100, 101, 180, 200, 201, 1000}) {
        var captured = new LinkedHashMap<String, List<Object[]>>();
        var recorder = mock(JdbcTemplate.class);
        when(recorder.batchUpdate(anyString(), org.mockito.ArgumentMatchers.<List<Object[]>>any())).thenAnswer(call -> {
          List<Object[]> rows = call.getArgument(1);
          captured.computeIfAbsent(call.getArgument(0), key -> new ArrayList<>()).addAll(rows);
          return new int[rows.size()];
        });
        var repository = new OrderRepository(recorder, new ObjectMapper());
        var items = IntStream.rangeClosed(1, size).mapToObj(n -> {
          var product = new ProductSnapshot(n, "M"+n, "商品"+n, "C", "P", "B", "V", "S", "12", "GENERAL", "ALL", false, new BigDecimal("100"), new BigDecimal("20"), null, 2L, new BigDecimal("80"), "INCREMENTAL");
          return new CalculatedItem(n, product, 3, OrderPricingCalculator.calculatePrice(new BigDecimal("100"), 2L, new BigDecimal("80"), "INCREMENTAL", 3), new BigDecimal("0.15"));
        }).toList();
        repository.insertCurrentItems(7, items); repository.insertVersionItems(9, items);
        var times = Map.of(100, new ArrayList<Double>(), 200, new ArrayList<Double>());
        for (int trial = 0; trial < 24; trial++) for (int batch : trial % 2 == 0 ? new int[]{100, 200} : new int[]{200, 100}) {
          jdbc.update("DELETE FROM order_item"); jdbc.update("DELETE FROM order_version_item");
          long start = System.nanoTime();
          transaction.executeWithoutResult(status -> captured.forEach((sql, rows) -> {
            for (int i=0; i<rows.size(); i+=batch) jdbc.batchUpdate(sql, rows.subList(i, Math.min(i+batch, rows.size())));
          }));
          if (trial >= 4) times.get(batch).add((System.nanoTime()-start)/1_000_000.0);
          assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_item", Integer.class)).isEqualTo(size);
          assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version_item", Integer.class)).isEqualTo(size);
          assertThat(jdbc.queryForObject("SELECT SUM(line_amount) FROM order_version_item", BigDecimal.class)).isEqualByComparingTo(BigDecimal.valueOf(size*260L));
        }
        times.forEach((batch, samples) -> {
          samples.sort(Double::compareTo);
          System.out.printf(Locale.ROOT, "BATCH_EXPERIMENT items=%d batch=%d medianMs=%.3f p95Ms=%.3f%n", size,batch,samples.get(10),samples.get(18));
        });
      }
    }
  }
}
