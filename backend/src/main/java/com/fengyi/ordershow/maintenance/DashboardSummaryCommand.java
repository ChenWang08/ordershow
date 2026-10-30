package com.fengyi.ordershow.maintenance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.dashboard.DashboardSummaryMaintenance;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/** Explicit server-side CLI; does not start HTTP, schedulers, Flyway, or bootstrap routines. */
public final class DashboardSummaryCommand {
  private DashboardSummaryCommand() {}

  public static void main(String[] args) throws Exception {
    if (args.length < 2 || args.length > 3 || !java.util.Set.of("check", "rebuild", "repair").contains(args[0])) {
      throw new IllegalArgumentException("Usage: DashboardSummaryCommand check|rebuild|repair activityId [afterOrderId]");
    }
    long activity = Long.parseLong(args[1]);
    long after = args.length == 3 ? Long.parseLong(args[2]) : 0;
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(required("DB_URL"));
    config.setUsername(required("DB_USERNAME"));
    config.setPassword(required("DB_PASSWORD"));
    config.setMaximumPoolSize(2);
    config.setConnectionInitSql("SET time_zone = '+00:00'");
    long checked = 0, differences = 0;
    try (var source = new HikariDataSource(config)) {
      var jdbc = new JdbcTemplate(source);
      if (jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=?", Long.class, activity) != 1) {
        throw new IllegalArgumentException("Activity does not exist");
      }
      var maintenance = new DashboardSummaryMaintenance(jdbc, new DataSourceTransactionManager(source));
      var json = new ObjectMapper();
      while (true) {
        var batch = "check".equals(args[0]) ? maintenance.reconcile(activity, after, 200)
            : maintenance.rebuild(activity, after, 200, "repair".equals(args[0]));
        System.out.println(json.writeValueAsString(batch));
        checked += batch.checked(); differences += batch.differences().size(); after = batch.nextAfterId();
        if (batch.checked() < 200) break;
      }
    }
    System.out.printf("checked=%d differences=%d nextAfterId=%d%n", checked, differences, after);
    if (differences > 0) throw new IllegalStateException("Summary reconciliation has differences; inspect batch output");
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("Required environment variable: " + name);
    return value;
  }
}
