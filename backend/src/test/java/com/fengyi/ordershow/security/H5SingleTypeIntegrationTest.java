package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_E2E", matches = "order-show-e2e")
class H5SingleTypeIntegrationTest {
  @Test void actualMysqlChecksPublishedTypesAndPreservesIdentityAndRegionGuards() {
    // Fixed disposable test port and credentials; never accepts a business DB URL.
    try (var source = new SingleConnectionDataSource(
        "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false",
        "root", "e2e_root_only_not_for_business", true)) {
      var jdbc = new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_e2e");
      jdbc.execute("CREATE DATABASE order_show_entry_test");
      try {
        jdbc.execute("USE order_show_entry_test");
        jdbc.execute("CREATE TABLE department(id BIGINT, status VARCHAR(20))");
        jdbc.execute("CREATE TABLE activity(id BIGINT, activity_code VARCHAR(80), department_id BIGINT, archived_at DATETIME, status VARCHAR(20), starts_at DATETIME, event_ends_at DATETIME)");
        jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT, data_type VARCHAR(30), current_version_id BIGINT)");
        jdbc.execute("CREATE TABLE activity_customer(id BIGINT, activity_id BIGINT, data_version_id BIGINT, is_active BOOLEAN, customer_type VARCHAR(20), region_code VARCHAR(40), branch_name VARCHAR(40), dealer_short_name VARCHAR(40), dealer_full_name VARCHAR(40), phone_masked VARCHAR(20), phone_lookup_hash VARBINARY(32))");
        jdbc.execute("CREATE TABLE h5_session(activity_id BIGINT, activity_customer_id BIGINT, token_hash VARBINARY(32), csrf_token_hash VARBINARY(32), expires_at DATETIME, last_seen_at DATETIME, ip_address VARBINARY(16), user_agent VARCHAR(512))");
        jdbc.update("INSERT INTO department VALUES(1,'ACTIVE')");
        jdbc.update("INSERT INTO activity VALUES(1,'ENTRY',1,NULL,'ACTIVE',UTC_TIMESTAMP() - INTERVAL 1 DAY,UTC_TIMESTAMP() + INTERVAL 1 DAY)");
        jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',10)");
        var props = new OrderShowProperties("http://localhost:3100", false, 1, 1, "test-hmac", "test-encrypt", "", "", "", null);
        var crypto = new CryptoService(props);
        var auth = new AuthService(jdbc, null, crypto, props);
        for (int id = 1; id <= 2; id++) jdbc.update("INSERT INTO activity_customer VALUES(?,1,10,TRUE,'GENERAL',?,'分公司','客户','测试客户','139****0001',?)",
            id, id == 1 ? "EAST" : null, crypto.lookupHash(id == 1 ? "13900000001" : "13900000002"));
        assertThat(login(auth, "GENERAL", null, "13900000001").regionCode()).isEqualTo("EAST");
        assertThat(login(auth, "GENERAL", "", "13900000002").regionCode()).isNull();
        assertThat(login(auth, "GENERAL", "EAST", "13900000001").customerId()).isEqualTo(1);
        reject(auth, "GENERAL", "WRONG", "13900000001");
        reject(auth, "GENERAL", "UNASSIGNED", "13900000001");
        reject(auth, "SPECIAL", null, "13900000001");
        reject(auth, "GENERAL", null, "13900000099");
        // Preview and inactive rows must not turn a single-type published list into a mixed one.
        jdbc.update("INSERT INTO activity_customer VALUES(3,1,11,TRUE,'SPECIAL',NULL,'','', '', '', ?)", crypto.lookupHash("13900000001"));
        jdbc.update("INSERT INTO activity_customer VALUES(4,1,10,FALSE,'SPECIAL',NULL,'','', '', '', ?)", crypto.lookupHash("13900000001"));
        assertThat(login(auth, "GENERAL", null, "13900000001").regionCode()).isEqualTo("EAST");
        jdbc.update("UPDATE activity_customer SET is_active=TRUE WHERE id=4");
        reject(auth, "GENERAL", null, "13900000001");
        reject(auth, "GENERAL", null, "13900000002");
        assertThat(login(auth, "GENERAL", "EAST", "13900000001").customerId()).isEqualTo(1);
        assertThat(login(auth, "GENERAL", "UNASSIGNED", "13900000002").customerId()).isEqualTo(2);
        assertThat(login(auth, "SPECIAL", null, "13900000001").customerId()).isEqualTo(4);
        // Publishing the preview changes the allowed identity immediately.
        jdbc.update("UPDATE activity_data_binding SET current_version_id=11");
        reject(auth, "GENERAL", null, "13900000001");
        assertThat(login(auth, "SPECIAL", null, "13900000001").customerId()).isEqualTo(3);
        jdbc.update("UPDATE activity_customer SET customer_type='ALL' WHERE id=3");
        assertThat(login(auth, "ALL", null, "13900000001").customerType()).isEqualTo("ALL");
        reject(auth, "SPECIAL", null, "13900000001");
        jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=3");
        reject(auth, "ALL", null, "13900000001");
        jdbc.update("UPDATE activity_data_binding SET current_version_id=10");
        jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=4");
        jdbc.update("INSERT INTO activity_customer SELECT 5,activity_id,data_version_id,is_active,customer_type,region_code,branch_name,dealer_short_name,dealer_full_name,phone_masked,phone_lookup_hash FROM activity_customer WHERE id=1");
        reject(auth, "GENERAL", null, "13900000001");
      } finally {
        jdbc.execute("USE order_show_e2e");
        jdbc.execute("DROP DATABASE order_show_entry_test");
      }
    }
  }

  private H5Principal login(AuthService auth, String type, String region, String phone) {
    return auth.verifyH5("ENTRY", type, region, phone, new MockHttpServletRequest(), new MockHttpServletResponse()).customer();
  }
  private void reject(AuthService auth, String type, String region, String phone) {
    assertThatThrownBy(() -> login(auth, type, region, phone)).isInstanceOf(DomainException.class);
  }
}
