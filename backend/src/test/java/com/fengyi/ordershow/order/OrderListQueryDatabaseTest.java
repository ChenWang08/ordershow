package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import com.fengyi.ordershow.security.CryptoService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Fixed disposable test database; no business connection string is accepted. */
@EnabledIfEnvironmentVariable(named = "ORDER_QUERY_TEST", matches = "order-query-test")
class OrderListQueryDatabaseTest {
  private static JdbcTemplate jdbc;
  private static OrderQueryService queries;

  @BeforeAll static void fixtures() {
    jdbc = new JdbcTemplate(new DriverManagerDataSource(
        "jdbc:mysql://mysql:3306/order_query_test?allowPublicKeyRetrieval=true&useSSL=false", "order_query_test", "query_test_only"));
    assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_query_test");
    // Minimal read-model tables with the production column types and pending unique index.
    jdbc.execute("CREATE TABLE activity_customer(id BIGINT PRIMARY KEY,phone VARCHAR(32),phone_masked VARCHAR(32),phone_lookup_hash BINARY(32))");
    jdbc.execute("""
        CREATE TABLE customer_order(id BIGINT PRIMARY KEY,activity_id BIGINT NOT NULL,activity_customer_id BIGINT NOT NULL,
          status VARCHAR(20),created_source VARCHAR(20),last_modified_source VARCHAR(20),customer_type VARCHAR(20),
          region_code VARCHAR(20),branch_name_snapshot VARCHAR(50),dealer_full_name_snapshot VARCHAR(100),
          current_version_no INT DEFAULT 1,lock_version INT DEFAULT 1,total_quantity BIGINT DEFAULT 1,
          total_tons DECIMAL(18,6) DEFAULT 0.1,total_amount DECIMAL(18,2) DEFAULT 100,
          order_no VARCHAR(50),first_submitted_at DATETIME(3),last_submitted_at DATETIME(3),last_modified_at DATETIME(3),
          KEY idx_order_activity_status_submit(activity_id,status,last_submitted_at))
        """);
    jdbc.execute("""
        CREATE TABLE order_change_request(id BIGINT PRIMARY KEY,activity_id BIGINT NOT NULL,order_id BIGINT NOT NULL,status VARCHAR(20),
          pending_order_id BIGINT GENERATED ALWAYS AS (CASE WHEN status='PENDING' THEN order_id ELSE NULL END) STORED,
          UNIQUE KEY uk_order_change_pending(pending_order_id),KEY idx_order_change_request_activity_status(activity_id,status))
        """);
    for (int i=1;i<=125;i++) {
      jdbc.update("INSERT INTO activity_customer VALUES(?,'13800000000','138****0000',NULL)",i);
      jdbc.update("""
          INSERT INTO customer_order(id,activity_id,activity_customer_id,status,customer_type,dealer_full_name_snapshot,order_no,last_modified_at)
          VALUES(?,7,?,?,'GENERAL',? ,?,'2026-11-01 01:00:00')
          """,i,i,i%3==0?"SUBMITTED":i%3==1?"WITHDRAWN":"VOIDED","Dealer "+i,"ORDER-"+i);
    }
    jdbc.update("INSERT INTO activity_customer VALUES(1000,'13900000000','139****0000',NULL)");
    jdbc.update("INSERT INTO customer_order(id,activity_id,activity_customer_id,status,order_no) VALUES(1000,8,1000,'SUBMITTED','OTHER')");
    jdbc.update("INSERT INTO order_change_request VALUES(901,7,1,'PENDING',DEFAULT),(902,7,1,'APPROVED',DEFAULT),(903,7,2,'PENDING',DEFAULT),(904,8,1000,'PENDING',DEFAULT)");
    queries = new OrderQueryService(jdbc, mock(CryptoService.class));
  }

  @Test void summaryCountsEveryStatusAndKeepsActivitiesSeparateIncludingEmptyOnes() {
    assertThat(queries.adminOrderCounts(7)).isEqualTo(new OrderQueryService.OrderCounts(125,41,42,42,2));
    assertThat(queries.adminOrderCounts(8)).isEqualTo(new OrderQueryService.OrderCounts(1,1,0,0,1));
    assertThat(queries.adminOrderCounts(9)).isEqualTo(new OrderQueryService.OrderCounts(0,0,0,0,0));
  }

  @Test void directLastPageHasOnlyItsRowsAndPendingJoinDoesNotDuplicateProcessedRequests() {
    var result=queries.adminOrders(7,null,null,null,3,50,"trace");
    assertThat(result.page().totalElements()).isEqualTo(125);
    assertThat(result.page().totalPages()).isEqualTo(3);
    assertThat(result.data()).hasSize(25);
    assertThat(result.data().stream().map(OrderService.OrderSummary::id)).containsExactlyElementsOf(
        java.util.stream.LongStream.iterate(25,i->i-1).limit(25).boxed().toList());
    assertThat(result.data().stream().filter(o->o.id()==1).findFirst().orElseThrow().pendingChangeRequestId()).isEqualTo(901L);
    assertThat(result.data().stream().filter(o->o.id()==2).findFirst().orElseThrow().pendingChangeRequestId()).isEqualTo(903L);
    assertThat(result.data().stream().filter(o->o.id()==3).findFirst().orElseThrow().pendingChangeRequestId()).isNull();
  }

  @Test void filtersAndBeyondLastPageKeepCorrectTotals() {
    var filtered=queries.adminOrders(7,"SUBMITTED","GENERAL","dealer",1,50,"trace");
    assertThat(filtered.data()).hasSize(41);
    assertThat(filtered.data()).allMatch(o->o.status().equals("SUBMITTED"));
    assertThat(queries.adminOrders(7,null,null,null,4,50,"trace").data()).isEmpty();
    assertThat(queries.adminOrders(9,null,null,null,1,50,"trace").page().totalElements()).isZero();
  }
}
