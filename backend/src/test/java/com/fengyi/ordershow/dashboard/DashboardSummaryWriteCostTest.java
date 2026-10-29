package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Focused write-cost comparison, not an HTTP submission capacity claim. Requires the scale fixture. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_SUMMARY_WRITE_BENCH",matches="order-show-e2e")
class DashboardSummaryWriteCostTest {
  @Test void measuresFullReplacementWithAndWithoutTriggerAndSummaryMaintenance() {
    try(var source=new SingleConnectionDataSource(DashboardSummaryIntegrationTest.URL+DashboardSummaryIntegrationTest.DB
        +DashboardSummaryIntegrationTest.OPTIONS,"root","e2e_root_only_not_for_business",true)) {
      var jdbc=new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_summary_test");
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_item WHERE order_id=13",Integer.class)).isEqualTo(180);
      new DashboardSummaryMaintenance(jdbc,new DataSourceTransactionManager(source)).rebuild(1,12,1,false);
      jdbc.execute("CREATE TEMPORARY TABLE summary_write_fixture AS SELECT * FROM order_item WHERE order_id=13");
      // A persistent InnoDB table keeps redo/binlog costs comparable; temporary tables would bias the baseline.
      jdbc.execute("DROP TABLE IF EXISTS summary_write_baseline");
      jdbc.execute("CREATE TABLE summary_write_baseline LIKE order_item");
      jdbc.execute("INSERT INTO summary_write_baseline SELECT * FROM summary_write_fixture");
      var store=new DashboardSummaryStore(jdbc,true,"");
      var tx=new TransactionTemplate(new DataSourceTransactionManager(source));tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
      Runnable before=() -> tx.executeWithoutResult(s -> {
        jdbc.update("DELETE FROM summary_write_baseline WHERE order_id=13");
        jdbc.update("INSERT INTO summary_write_baseline SELECT * FROM summary_write_fixture");
        s.setRollbackOnly();
      });
      Runnable after=() -> tx.executeWithoutResult(s -> {
        jdbc.update("DELETE FROM order_item WHERE order_id=13");
        jdbc.update("INSERT INTO order_item SELECT * FROM summary_write_fixture");
        store.refresh(13);s.setRollbackOnly();
      });
      DashboardSummaryIntegrationTest.benchmark("write-180-items-rollback",before,after);
      assertThat(new DashboardSummaryMaintenance(jdbc,new DataSourceTransactionManager(source)).reconcile(1,12,1).differences()).isEmpty();
    }
  }
}
