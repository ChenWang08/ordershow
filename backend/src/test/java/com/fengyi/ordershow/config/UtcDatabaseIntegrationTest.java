package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.common.UtcTime;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;

/** Uses only a temporary table in the disposable test database; never connects to business data. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_E2E", matches = "order-show-e2e")
class UtcDatabaseIntegrationTest {
  @Test
  void utcSessionDefaultsWritesUpdatesAndReadsSurviveJvmAndDatabaseTimezoneDifferences() {
    var yaml = new YamlPropertiesFactoryBean();
    yaml.setResources(new ClassPathResource("application.yml"));
    var properties = yaml.getObject();
    var original = TimeZone.getDefault();
    try {
      for (String zone : new String[]{"UTC", "Asia/Shanghai", "America/Los_Angeles"}) {
        TimeZone.setDefault(TimeZone.getTimeZone(zone));
        var config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://host.docker.internal:33306/order_show_e2e?serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false");
        config.setUsername("order_show_e2e");
        config.setPassword("e2e_mysql_only_not_for_business");
        config.setMaximumPoolSize(1);
        config.setConnectionInitSql(properties.getProperty("spring.datasource.hikari.connection-init-sql"));
        String prefix = "spring.datasource.hikari.data-source-properties.";
        for (String key : properties.stringPropertyNames()) {
          if (key.startsWith(prefix)) config.addDataSourceProperty(key.substring(prefix.length()), properties.getProperty(key));
        }
        try (var pool = new HikariDataSource(config)) {
          var jdbc = new JdbcTemplate(pool);
          assertThat(jdbc.queryForObject("SELECT @@session.time_zone", String.class)).isEqualTo("+00:00");
          jdbc.execute("CREATE TEMPORARY TABLE utc_time_probe(id INT PRIMARY KEY, n INT DEFAULT 0, requested_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), explicit_at DATETIME(3), expires_at DATETIME(3))");
          var instant = Instant.parse("2026-10-19T05:41:03.123Z");
          jdbc.update("INSERT INTO utc_time_probe(id,explicit_at,expires_at) VALUES(1,?,UTC_TIMESTAMP(3)+INTERVAL 1 HOUR)", UtcTime.database(instant));
          assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(SECOND,requested_at,UTC_TIMESTAMP(3)) FROM utc_time_probe", Long.class)).isBetween(0L, 2L);
          assertThat(jdbc.queryForObject("SELECT explicit_at FROM utc_time_probe", LocalDateTime.class)).isEqualTo(UtcTime.database(instant));
          Instant read = jdbc.queryForObject("SELECT explicit_at FROM utc_time_probe", (rs, n) -> UtcTime.read(rs, 1));
          assertThat(read).isEqualTo(instant);
          assertThat(UtcTime.instant(jdbc.queryForMap("SELECT explicit_at FROM utc_time_probe").get("explicit_at"))).isEqualTo(instant);
          jdbc.update("UPDATE utc_time_probe SET n=1 WHERE id=1");
          assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(SECOND,updated_at,UTC_TIMESTAMP(3)) FROM utc_time_probe", Long.class)).isBetween(0L, 2L);
          assertThat(jdbc.queryForObject("SELECT expires_at>UTC_TIMESTAMP(3) FROM utc_time_probe", Boolean.class)).isTrue();
          jdbc.update("UPDATE utc_time_probe SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
          assertThat(jdbc.queryForObject("SELECT expires_at>UTC_TIMESTAMP(3) FROM utc_time_probe", Boolean.class)).isFalse();
        }
      }
    } finally { TimeZone.setDefault(original); }
  }
}
