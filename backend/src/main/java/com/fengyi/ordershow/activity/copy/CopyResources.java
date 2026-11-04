package com.fengyi.ordershow.activity.copy;

import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.storage.ObjectStorage;
import com.fengyi.ordershow.storage.StorageService;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** Wrapped rather than a DataSource bean: must not replace Boot's business connection pool. */
@Component
public class CopyResources implements AutoCloseable {
  final HikariDataSource pool;
  final JdbcTemplate jdbc;
  final TransactionTemplate tx;
  final StorageService storage;
  final ObjectStorage objects;
  final String bucket;
  public CopyResources(DataSourceProperties properties,OrderShowProperties configuration,ObjectStorage objects){
    pool=properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
    pool.setPoolName("configuration-copy");pool.setMaximumPoolSize(1);pool.setMinimumIdle(0);pool.setConnectionTimeout(5000);
    pool.setIdleTimeout(10000);
    pool.setConnectionInitSql("SET time_zone = '+00:00'");
    pool.addDataSourceProperty("connectionTimeZone","UTC");pool.addDataSourceProperty("forceConnectionTimeZoneToSession",true);
    pool.addDataSourceProperty("rewriteBatchedStatements",true);pool.addDataSourceProperty("connectTimeout",5000);pool.addDataSourceProperty("socketTimeout",45000);
    jdbc=new JdbcTemplate(pool);jdbc.setQueryTimeout(10);
    tx=new TransactionTemplate(new DataSourceTransactionManager(pool));tx.setTimeout(30);
    this.objects=objects;bucket=configuration.storage().bucket();storage=new StorageService(configuration,jdbc,objects);
  }
  public void close(){pool.close();}
}
