package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_LOAD",matches="order-show-load")
class OrderWriteLockIntegrationTest {
  @Test
  void waitingWriterSeesCommittedCloseAfterAcquiringSharedLock() throws Exception {
    var source=new DriverManagerDataSource("jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false","order_show_load","load_only_password");
    var jdbc=new JdbcTemplate(source);
    assertEquals("order_show_load",jdbc.queryForObject("SELECT DATABASE()",String.class));
    long activity=jdbc.queryForObject("SELECT id FROM activity WHERE activity_code='LOAD-2'",Long.class);
    long customer=jdbc.queryForObject("SELECT MIN(id) FROM activity_customer WHERE activity_id=?",Long.class,activity);
    String original=jdbc.queryForObject("SELECT status FROM activity WHERE id=?",String.class,activity);
    assertEquals("ACTIVE",original);
    var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);tx.setTimeout(10);
    var closed=new CountDownLatch(1);var commit=new CountDownLatch(1);var read=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(2)) {
      var closing=pool.submit(()->tx.execute(status->{
        jdbc.update("UPDATE activity SET status='CLOSED' WHERE id=?",activity);closed.countDown();
        try {if(!commit.await(5,TimeUnit.SECONDS))throw new AssertionError("Commit timed out");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new RuntimeException(e);}return true;
      }));
      try {
        assertTrue(closed.await(3,TimeUnit.SECONDS));
        var writer=pool.submit(()->tx.execute(status->{
          assertEquals("ACTIVE",jdbc.queryForObject("SELECT status FROM activity WHERE id=?",String.class,activity));read.countDown();
          OrderWriteLock.acquire(jdbc,activity,customer);
          return jdbc.queryForObject("SELECT status FROM activity WHERE id=?",String.class,activity);
        }));
        assertTrue(read.await(3,TimeUnit.SECONDS));
        assertThrows(TimeoutException.class,()->writer.get(200,TimeUnit.MILLISECONDS));
        commit.countDown();assertTrue(closing.get(3,TimeUnit.SECONDS));assertEquals("CLOSED",writer.get(3,TimeUnit.SECONDS));
      }finally {commit.countDown();}
    }finally {jdbc.update("UPDATE activity SET status=? WHERE id=? AND activity_code='LOAD-2'",original,activity);}
  }

  @Test
  void differentCustomersRunTogetherButSameCustomerAndExclusiveActivityWritesWait() throws Exception {
    // Fixed isolated DNS/database; this test never accepts a business connection string.
    var source=new DriverManagerDataSource("jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false","order_show_load","load_only_password");
    var jdbc=new JdbcTemplate(source);
    assertEquals("order_show_load",jdbc.queryForObject("SELECT DATABASE()",String.class));
    long activity=jdbc.queryForObject("SELECT id FROM activity WHERE activity_code='LOAD-1'",Long.class);
    var customers=jdbc.queryForList("SELECT id FROM activity_customer WHERE activity_id=? AND is_active=TRUE ORDER BY id LIMIT 2",Long.class,activity);
    assertEquals(2,customers.size());
    var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);tx.setTimeout(10);
    var held=new CountDownLatch(1);var release=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(4)) {
      var first=pool.submit(()->tx.execute(status->{OrderWriteLock.acquire(jdbc,activity,customers.getFirst());held.countDown();
        try {if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("Release timed out");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new RuntimeException(e);}return true;}));
      try {
        assertTrue(held.await(3,TimeUnit.SECONDS));
        var other=pool.submit(()->tx.execute(status->{OrderWriteLock.acquire(jdbc,activity,customers.get(1));return true;}));
        assertTrue(other.get(2,TimeUnit.SECONDS),"Different customers must not serialize on activity");
        var same=pool.submit(()->tx.execute(status->{OrderWriteLock.acquire(jdbc,activity,customers.getFirst());return true;}));
        assertThrows(TimeoutException.class,()->same.get(200,TimeUnit.MILLISECONDS));
        var exclusive=pool.submit(()->tx.execute(status->{jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE",activity);return true;}));
        assertThrows(TimeoutException.class,()->exclusive.get(200,TimeUnit.MILLISECONDS));
        release.countDown();assertTrue(first.get(3,TimeUnit.SECONDS));assertTrue(same.get(3,TimeUnit.SECONDS));assertTrue(exclusive.get(3,TimeUnit.SECONDS));
      }finally {release.countDown();}
    }
  }
}
