package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.assertThat;

import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.HashSet;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.actuate.autoconfigure.metrics.CompositeMeterRegistryAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.MetricsAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.export.simple.SimpleMetricsExportAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.metrics.jdbc.DataSourcePoolMetricsAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration;
import org.springframework.boot.autoconfigure.transaction.TransactionAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Real Boot binding, metrics and Flyway initialization; fixed disposable database only. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_ACTIVITY_TEST", matches = "activity-lifecycle-only")
class ActivityWriteStartupTest {
  @ParameterizedTest
  @CsvSource({"4,1,750", "8,2,1500"})
  void metricsAndFlywayAllowHikariPropertiesToBindBeforePoolStarts(int maximum, int idle, int timeout) {
    var fullyProcessed = new HashSet<String>();
    new ApplicationContextRunner()
        .withInitializer(new ConfigDataApplicationContextInitializer())
        .withConfiguration(AutoConfigurations.of(
            ConfigurationPropertiesAutoConfiguration.class,
            DataSourceAutoConfiguration.class,
            JdbcTemplateAutoConfiguration.class,
            DataSourceTransactionManagerAutoConfiguration.class,
            TransactionAutoConfiguration.class,
            FlywayAutoConfiguration.class,
            MetricsAutoConfiguration.class,
            SimpleMetricsExportAutoConfiguration.class,
            CompositeMeterRegistryAutoConfiguration.class,
            DataSourcePoolMetricsAutoConfiguration.class))
        .withUserConfiguration(ActivityWriteConfiguration.class, ActivityAccessPolicy.class)
        .withBean("lifecycleInitializationObserver", BeanPostProcessor.class, () -> new BeanPostProcessor() {
          @Override public Object postProcessAfterInitialization(Object bean, String name) {
            fullyProcessed.add(name);
            return bean;
          }
        })
        .withPropertyValues(
            "spring.datasource.url=" + ActivityLifecycleIntegrationTest.URL,
            "spring.datasource.username=root",
            "spring.datasource.password=activity_test_only",
            "spring.datasource.hikari.pool-name=activity-startup-test",
            "spring.datasource.hikari.maximum-pool-size=" + maximum,
            "spring.datasource.hikari.minimum-idle=" + idle,
            "spring.datasource.hikari.connection-timeout=" + timeout,
            "spring.datasource.hikari.connection-init-sql=SET time_zone = '+00:00'",
            "spring.datasource.hikari.data-source-properties.rewriteBatchedStatements=true",
            "spring.flyway.locations=classpath:db/migration",
            "spring.flyway.user=root",
            "spring.flyway.password=activity_test_only")
        .run(context -> {
          assertThat(context).hasNotFailed();
          // These beans must be created after all post-processors have been registered.
          assertThat(fullyProcessed).contains("activityAccessPolicy", "transactionManager", "jdbcTemplate", "dataSource");
          var pool = context.getBean(HikariDataSource.class);
          assertThat(pool.getMaximumPoolSize()).isEqualTo(maximum);
          assertThat(pool.getMinimumIdle()).isEqualTo(idle);
          assertThat(pool.getConnectionTimeout()).isEqualTo(timeout);
          assertThat(pool.getConnectionInitSql()).isEqualTo("SET time_zone = '+00:00'");
          assertThat(pool.getDataSourceProperties().getProperty("rewriteBatchedStatements")).isEqualTo("true");
          var sql = context.getBean(JdbcTemplate.class);
          assertThat(sql.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_activity_lifecycle_test");
          assertThat(sql.queryForObject("SELECT @@session.time_zone", String.class)).isEqualTo("+00:00");
          // Binding must preserve observability as well as connectivity.
          assertThat(context.getBean(MeterRegistry.class).find("hikaricp.connections").gauge()).isNotNull();
          var tx = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
          assertThat(context).hasSingleBean(ActivityAccessPolicy.class);
          assertThat(sql.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1", Integer.class)).isPositive();
          Integer result = tx.execute(status -> {
            assertThat(status.isNewTransaction()).isTrue();
            return sql.queryForObject("SELECT 1", Integer.class);
          });
          assertThat(result).isEqualTo(1);
        });
  }
}
