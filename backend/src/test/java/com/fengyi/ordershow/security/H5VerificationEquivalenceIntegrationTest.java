package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** Baseline SQL is frozen from dc4b76c. Only the disposable load server is allowed. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_LOAD", matches="order-show-load")
class H5VerificationEquivalenceIntegrationTest {
  record Outcome(String error, H5Principal customer) {}

  @Test void matchesOldSqlAcrossPublicationModesRegionsAndActivityStates() throws Exception {
    try (var source = new SingleConnectionDataSource(
        "jdbc:mysql://mysql:3306/order_show_load?allowPublicKeyRetrieval=true&useSSL=false",
        "root", "load_only_root", true)) {
      var jdbc = new JdbcTemplate(source);
      assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_load");
      // Separate schema: MySQL cannot reopen a temporary table in correlated subqueries.
      String schema = "order_show_h5opt_equivalence";
      jdbc.execute("CREATE DATABASE " + schema);
      try {
        jdbc.execute("USE " + schema);
        jdbc.execute("CREATE TABLE department(id BIGINT PRIMARY KEY, status VARCHAR(20))");
        jdbc.execute("CREATE TABLE activity(id BIGINT PRIMARY KEY, activity_code VARCHAR(80) UNIQUE, department_id BIGINT, archived_at DATETIME, status VARCHAR(20), starts_at DATETIME, event_ends_at DATETIME)");
        jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT, data_type VARCHAR(30), current_version_id BIGINT, UNIQUE KEY(activity_id,data_type))");
        jdbc.execute("CREATE TABLE activity_customer(id BIGINT PRIMARY KEY, activity_id BIGINT, data_version_id BIGINT, is_active BOOLEAN, customer_type VARCHAR(20), region_code VARCHAR(40), branch_name VARCHAR(40), dealer_short_name VARCHAR(40), dealer_full_name VARCHAR(40), phone_masked VARCHAR(20), phone_lookup_hash VARBINARY(32))");
        jdbc.execute("CREATE TABLE h5_session(activity_id BIGINT, activity_customer_id BIGINT, token_hash VARBINARY(32), csrf_token_hash VARBINARY(32), expires_at DATETIME, last_seen_at DATETIME, ip_address VARBINARY(16), user_agent VARCHAR(512))");
        jdbc.update("INSERT INTO department VALUES(1,'ACTIVE')");
        jdbc.update("INSERT INTO activity VALUES(1,'ENTRY',1,NULL,'ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY)");
        var props = new OrderShowProperties("http://localhost:3200", false, 1, 1, "test-hmac", "test-encrypt", "", "", "", null);
        var crypto = new CryptoService(props);
        var auth = new AuthService(jdbc, null, crypto, props);
        int cases = 0;
        for (String mode : new String[]{"GENERAL", "MIXED", "ALL", "EMPTY"}) {
          jdbc.update("DELETE FROM activity_customer");
          if (!mode.equals("EMPTY")) {
            for (int i = 1; i <= 4; i++) {
              String type = mode.equals("ALL") ? "ALL" : mode.equals("MIXED") && i == 4 ? "SPECIAL" : "GENERAL";
              String region = new String[]{null, "", " ", "EAST"}[i-1];
              jdbc.update("INSERT INTO activity_customer VALUES(?,1,10,TRUE,?,?,'B','S','F','139****0001',?)", i, type, region, crypto.lookupHash("1390000000"+i));
            }
            jdbc.update("INSERT INTO activity_customer VALUES(5,1,11,TRUE,'SPECIAL',NULL,'B','S','F','',?)", crypto.lookupHash("13900000001"));
            jdbc.update("INSERT INTO activity_customer VALUES(6,1,10,FALSE,'ALL',NULL,'B','S','F','',?)", crypto.lookupHash("13900000006"));
          }
          for (int binding : new int[]{10, 11, 0, -1}) {
            jdbc.update("DELETE FROM activity_data_binding");
            if (binding >= 0) jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',?)", binding == 0 ? null : binding);
            for (String type : Arrays.asList(null, "GENERAL", "SPECIAL", "ALL"))
              for (String region : Arrays.asList(null, "", "EAST", "WRONG", "UNASSIGNED"))
                for (String phone : new String[]{"13900000001", "13900000004", "13900000099"}) {
                  compare(jdbc, auth, crypto, "ENTRY", type, region, phone); cases++;
                }
          }
        }
        // Mutations take effect on the next request, including changes within the same version.
        jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',10)");
        jdbc.update("INSERT INTO activity_customer VALUES(1,1,10,TRUE,'GENERAL','EAST','B','S','F','',?)", crypto.lookupHash("13900000001"));
        for (String state : new String[]{"SCHEDULED", "ACTIVE", "CLOSED", "FINISHED", "DRAFT"}) {
          jdbc.update("UPDATE activity SET status=?", state);
          compare(jdbc, auth, crypto, "ENTRY", "GENERAL", null, "13900000001"); cases++;
        }
        for (String mutation : new String[]{
            "UPDATE activity SET status='ACTIVE', starts_at=UTC_TIMESTAMP()+INTERVAL 1 DAY",
            "UPDATE activity SET status='CLOSED'",
            "UPDATE activity SET event_ends_at=UTC_TIMESTAMP()-INTERVAL 1 DAY",
            "UPDATE activity SET event_ends_at=NULL, archived_at=UTC_TIMESTAMP()",
            "UPDATE activity SET archived_at=NULL",
            "UPDATE department SET status='DISABLED'",
            "UPDATE department SET status='ACTIVE'",
            "UPDATE activity_customer SET is_active=FALSE"}) {
          jdbc.update(mutation);
          compare(jdbc, auth, crypto, "ENTRY", "GENERAL", null, "13900000001"); cases++;
        }
        for (String type : new String[]{"ALL", "GENERAL"}) {
          compare(jdbc, auth, crypto, "MISSING", type, null, "13900000001"); cases++;
        }
        System.out.println("H5_VERIFICATION_EQUIVALENCE_CASES=" + cases);
      } finally { jdbc.execute("USE order_show_load"); jdbc.execute("DROP DATABASE " + schema); }
    }
  }

  private void compare(JdbcTemplate jdbc, AuthService auth, CryptoService crypto, String code, String type, String region, String phone) throws Exception {
    String requestedType = type == null || type.isBlank() ? "ALL" : type.trim();
    String requestedRegion = region == null || region.isBlank() ? null : region.trim();
    boolean all = jdbc.queryForList(resource("types"), String.class, code).contains("ALL");
    Outcome expected;
    if (all != requestedType.equals("ALL")) expected = new Outcome("WHITELIST_MODE_MISMATCH", null);
    else {
      var rows = jdbc.query(resource("identity"), (rs, n) -> new H5Principal(0, rs.getLong("activity_id"), rs.getLong("activity_customer_id"), rs.getString("activity_code"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"), rs.getString("dealer_full_name"), rs.getString("phone_masked")),
          code, requestedType, crypto.lookupHash(phone), requestedRegion, requestedRegion, requestedRegion, requestedRegion, requestedRegion, requestedRegion);
      expected = rows.size() == 1 ? new Outcome(null, rows.getFirst()) : new Outcome("WHITELIST_IDENTITY_NOT_FOUND", null);
    }
    long before = jdbc.queryForObject("SELECT COUNT(*) FROM h5_session", Long.class);
    Outcome actual;
    try {
      var response = new MockHttpServletResponse();
      var login = auth.verifyH5(code, type, region, phone, new MockHttpServletRequest(), response);
      assertThat(login.csrfToken()).isNotBlank();
      assertThat(response.getHeaders("Set-Cookie")).hasSize(2);
      actual = new Outcome(null, login.customer());
    } catch (DomainException error) { actual = new Outcome(error.code(), null); }
    assertThat(actual).as("%s %s %s %s", code, type, region, phone).isEqualTo(expected);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_session", Long.class)).isEqualTo(before + (expected.error() == null ? 1 : 0));
  }

  private String resource(String name) throws Exception {
    try (var stream = getClass().getResourceAsStream("/baseline/h5-verify-" + name + ".sql")) {
      return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
  }
}
