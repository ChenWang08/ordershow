package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import java.sql.DriverManager;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Connection-private temporary tables; the business database is never addressable by this test. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_E2E",matches="order-show-e2e")
class H5IdempotencyPersistenceTest {
  private java.sql.Connection connection() throws Exception {
    var connection = DriverManager.getConnection(
        "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false",
        "order_show_e2e","e2e_mysql_only_not_for_business");
    var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection,true));
    assertEquals("order_show_e2e",jdbc.queryForObject("SELECT DATABASE()",String.class));
    jdbc.execute("CREATE TEMPORARY TABLE activity(id BIGINT PRIMARY KEY,status VARCHAR(20),ends_at DATETIME(3),event_ends_at DATETIME(3)) ENGINE=InnoDB");
    jdbc.execute("""
        CREATE TEMPORARY TABLE api_idempotency(
          id BIGINT AUTO_INCREMENT PRIMARY KEY,activity_id BIGINT,actor_type VARCHAR(20),actor_id BIGINT,
          endpoint_code VARCHAR(64),idempotency_key VARCHAR(128),request_hash BINARY(32),status VARCHAR(20),
          expires_at DATETIME(3),completed_at DATETIME(3),http_status INT,resource_type VARCHAR(20),resource_id BIGINT,response_json JSON,
          UNIQUE KEY idem(activity_id,actor_type,actor_id,endpoint_code,idempotency_key)) ENGINE=InnoDB
        """);
    jdbc.update("INSERT INTO activity VALUES(1,'FINISHED',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 60 DAY),NULL),(2,'CLOSED',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),NULL)");
    return connection;
  }

  @Test void rollbackDoesNotLeaveAPoisonedKeyAndReplayReturnsTheStoredSnapshot() throws Exception {
    try (var connection=connection()) {
      var source = new SingleConnectionDataSource(connection,true);
      var jdbc = new JdbcTemplate(source);
      var json = new ObjectMapper().findAndRegisterModules();
      var repository = new OrderRepository(jdbc,json);
      var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
      var body = new OrderService.SubmitRequest(0,List.of(new OrderService.SubmitItem(1,2)));
      byte[] hash = H5SubmitFingerprint.digest(body,false);
      var result = json.readValue("{\"id\":11,\"currentVersion\":1,\"totalAmount\":1234567890123456.78,\"items\":[],\"versions\":[],\"operations\":[]}",OrderService.OrderView.class);
      assertThrows(IllegalStateException.class,() -> tx.execute(status -> {
        assertNull(repository.beginH5Submission(1,3,"k",hash,hash));
        repository.completeH5Submission(1,3,"k",result,false);
        throw new IllegalStateException("fail before commit");
      }));
      assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM api_idempotency",Integer.class));
      tx.executeWithoutResult(status -> {
        assertNull(repository.beginH5Submission(1,3,"k",hash,hash));
        repository.completeH5Submission(1,3,"k",result,false);
      });
      assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM api_idempotency",Integer.class));
      assertEquals("2",jdbc.queryForObject("SELECT JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.format')) FROM api_idempotency",String.class));
      assertEquals("11",jdbc.queryForObject("SELECT JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.orderId')) FROM api_idempotency",String.class));
      assertEquals(0,jdbc.queryForObject("SELECT JSON_CONTAINS_PATH(response_json,'one','$.resultJson') FROM api_idempotency",Integer.class));
      var changed=H5SubmitFingerprint.digest(new OrderService.SubmitRequest(1,body.items()),false);
      assertEquals("IDEMPOTENCY_KEY_REUSED",assertThrows(DomainException.class,
          () -> tx.execute(status -> repository.beginH5Submission(1,3,"k",changed,hash))).code());
      jdbc.update("UPDATE api_idempotency SET response_json=JSON_OBJECT('orderId',11)");
      assertEquals("IDEMPOTENCY_RESULT_UNAVAILABLE",assertThrows(DomainException.class,
          () -> tx.execute(status -> repository.beginH5Submission(1,3,"k",hash,hash))).code());
    }
  }

  @Test void cleanupProtectsProcessingOtherEndpointsLegacyAndExtendedActivitiesAndIsBounded() throws Exception {
    try (var connection=connection()) {
      var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection,true));
      String insert="""
          INSERT INTO api_idempotency(activity_id,actor_type,actor_id,endpoint_code,idempotency_key,
            status,expires_at,completed_at,response_json)
          VALUES(?,'H5_CUSTOMER',3,?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),
            DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 40 DAY),?)
          """;
      for(int i=0;i<505;i++) jdbc.update(insert,1,"ORDER_SUBMIT","old-"+i,"COMPLETED","{\"format\":2}");
      jdbc.update(insert,1,"ORDER_SUBMIT","pending","PROCESSING","{\"format\":2}");
      jdbc.update(insert,1,"ORDER_WITHDRAW","other","COMPLETED","{\"format\":2}");
      jdbc.update(insert,1,"ORDER_SUBMIT","legacy","COMPLETED","{\"orderId\":11}");
      jdbc.update(insert,2,"ORDER_SUBMIT","extended","COMPLETED","{\"format\":2}");
      jdbc.update(insert,1,"ORDER_SUBMIT","recent","COMPLETED","{\"format\":2}");
      jdbc.update("UPDATE api_idempotency SET completed_at=UTC_TIMESTAMP(3) WHERE idempotency_key='recent'");
      var cleanup = new H5IdempotencyCleanup(jdbc);
      assertEquals(500,cleanup.cleanBatch());
      assertEquals(5,cleanup.cleanBatch());
      assertEquals(0,cleanup.cleanBatch());
      assertEquals(5,jdbc.queryForObject("SELECT COUNT(*) FROM api_idempotency",Integer.class));
    }
  }
}
