package com.fengyi.ordershow.exports;

import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.order.OrderQueryService;
import com.fengyi.ordershow.security.CryptoService;
import com.fengyi.ordershow.storage.StorageService;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="order-show.export.worker",havingValue="true")
@EnableAutoConfiguration(exclude=org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration.class)
@EnableScheduling
@EnableConfigurationProperties({OrderShowProperties.class,DataSourceProperties.class})
@Import({ExportRepository.class,ExportPolicy.class,StorageService.class,com.fengyi.ordershow.storage.StorageConfiguration.class})
public class ExportWorkerApplication {
  @Bean @Primary HikariDataSource dataSource(DataSourceProperties p){return pool(p,"export-control");}
  @Bean(name="exportReadDataSource") HikariDataSource readDataSource(DataSourceProperties p){return pool(p,"export-read");}
  private static HikariDataSource pool(DataSourceProperties p,String name) {
    var ds=p.initializeDataSourceBuilder().type(HikariDataSource.class).build();
    ds.setPoolName(name);ds.setMaximumPoolSize(1);ds.setMinimumIdle(0);ds.setConnectionTimeout(5000);
    ds.addDataSourceProperty("connectTimeout",5000);ds.addDataSourceProperty("socketTimeout",150000);
    ds.setConnectionInitSql("SET time_zone = '+00:00'");ds.addDataSourceProperty("connectionTimeZone","UTC");
    ds.addDataSourceProperty("forceConnectionTimeZoneToSession",true);return ds;
  }
  @Bean CsvExportGenerator generator(@Qualifier("exportReadDataSource") DataSource ds,OrderShowProperties properties,Environment env) {
    var jdbc=new JdbcTemplate(ds);jdbc.setQueryTimeout(30);
    return new CsvExportGenerator(jdbc,new DataSourceTransactionManager(ds),new OrderQueryService(jdbc,new CryptoService(properties)),
        env.getProperty("order-show.export.batch-size",Integer.class,2000),env.getProperty("order-show.export.read-timeout-seconds",Integer.class,120),
        env.getProperty("order-show.export.max-temp-bytes",Long.class,1073741824L));
  }
  @Bean(destroyMethod="close") ExportRunner runner(ExportRepository tasks,ExportPolicy policy,CsvExportGenerator generator,StorageService storage,Environment env) {
    return new ExportRunner(tasks,policy,generator,storage,Path.of(env.getProperty("order-show.export.temp-dir",System.getProperty("java.io.tmpdir")+"/order-exports")),
        env.getProperty("order-show.export.max-temp-bytes",Long.class,1073741824L),env.getProperty("order-show.export.retention-hours",Integer.class,24));
  }
}
