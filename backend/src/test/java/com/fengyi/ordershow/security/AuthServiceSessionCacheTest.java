package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.activity.ActivityFinishedEvent;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceSessionCacheTest {
  private JdbcTemplate jdbc;
  private PasswordEncoder passwordEncoder;
  private CryptoService crypto;
  private OrderShowProperties properties;
  private AuthService authService;

  @BeforeEach
  void setUp() {
    jdbc = mock(JdbcTemplate.class);
    passwordEncoder = mock(PasswordEncoder.class);
    properties = new OrderShowProperties("http://localhost:3000", false, 8, 24, "test-phone-key-32-bytes-long!!", "test-enc-key-32-bytes-long!!!!!", "admin", "ChangeMe123!", "dev", null);
    crypto = new CryptoService(properties);
    // Use 100ms TTL for fast test execution
    authService = new AuthService(jdbc, passwordEncoder, crypto, properties, 100);
  }

  @Test
  void requireH5_cachesResolvedSessionWithinTtl() {
    String token = "test-h5-session-token-123456789";
    MockHttpServletRequest request1 = new MockHttpServletRequest();
    request1.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));

    H5Principal principal = new H5Principal(101L, 1L, 201L, "ACT-001", "GENERAL", "EAST", "Branch A", "Dealer A", "Dealer A Full", "139****1234");
    byte[] csrfHash = crypto.sha256("test-csrf-token");

    when(jdbc.query(anyString(), any(RowMapper.class), any())).thenAnswer(invocation -> {
      RowMapper<H5Principal> mapper = invocation.getArgument(1);
      java.sql.ResultSet rs = mock(java.sql.ResultSet.class);
      when(rs.getLong("session_id")).thenReturn(principal.sessionId());
      when(rs.getLong("activity_id")).thenReturn(principal.activityId());
      when(rs.getLong("activity_customer_id")).thenReturn(principal.customerId());
      when(rs.getString("activity_code")).thenReturn(principal.activityCode());
      when(rs.getString("customer_type")).thenReturn(principal.customerType());
      when(rs.getString("region_code")).thenReturn(principal.regionCode());
      when(rs.getString("branch_name")).thenReturn(principal.branchName());
      when(rs.getString("dealer_short_name")).thenReturn(principal.dealerShortName());
      when(rs.getString("dealer_full_name")).thenReturn(principal.dealerFullName());
      when(rs.getString("phone_masked")).thenReturn(principal.phoneMasked());
      when(rs.getBytes("csrf_token_hash")).thenReturn(csrfHash);
      return List.of(mapper.mapRow(rs, 1));
    });

    // First call: hits DB
    H5Principal result1 = authService.requireH5(request1);
    assertThat(result1.customerId()).isEqualTo(201L);
    assertThat(authService.cachedH5SessionCount()).isEqualTo(1);
    verify(jdbc, times(1)).query(anyString(), any(RowMapper.class), any());

    // Second call with new request object: hits cache, NO DB call
    MockHttpServletRequest request2 = new MockHttpServletRequest();
    request2.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));
    H5Principal result2 = authService.requireH5(request2);
    assertThat(result2.customerId()).isEqualTo(201L);
    verify(jdbc, times(1)).query(anyString(), any(RowMapper.class), any());
  }

  @Test
  void requireH5_cacheExpiresAfterTtl() throws InterruptedException {
    String token = "test-h5-session-token-expiring";
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));

    H5Principal principal = new H5Principal(102L, 1L, 202L, "ACT-001", "GENERAL", "EAST", "Branch A", "Dealer A", "Dealer A Full", "139****1234");
    byte[] csrfHash = crypto.sha256("test-csrf-token");

    when(jdbc.query(anyString(), any(RowMapper.class), any())).thenAnswer(invocation -> {
      RowMapper<H5Principal> mapper = invocation.getArgument(1);
      java.sql.ResultSet rs = mock(java.sql.ResultSet.class);
      when(rs.getLong("session_id")).thenReturn(principal.sessionId());
      when(rs.getLong("activity_id")).thenReturn(principal.activityId());
      when(rs.getLong("activity_customer_id")).thenReturn(principal.customerId());
      when(rs.getString("activity_code")).thenReturn(principal.activityCode());
      when(rs.getString("customer_type")).thenReturn(principal.customerType());
      when(rs.getString("region_code")).thenReturn(principal.regionCode());
      when(rs.getString("branch_name")).thenReturn(principal.branchName());
      when(rs.getString("dealer_short_name")).thenReturn(principal.dealerShortName());
      when(rs.getString("dealer_full_name")).thenReturn(principal.dealerFullName());
      when(rs.getString("phone_masked")).thenReturn(principal.phoneMasked());
      when(rs.getBytes("csrf_token_hash")).thenReturn(csrfHash);
      return List.of(mapper.mapRow(rs, 1));
    });

    authService.requireH5(request);
    verify(jdbc, times(1)).query(anyString(), any(RowMapper.class), any());

    // Sleep past TTL (100ms)
    Thread.sleep(120);

    MockHttpServletRequest requestAfterTtl = new MockHttpServletRequest();
    requestAfterTtl.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));
    authService.requireH5(requestAfterTtl);
    verify(jdbc, times(2)).query(anyString(), any(RowMapper.class), any());
  }

  @Test
  void evictFinishedActivitySessions_removesEntriesForActivity() {
    String token = "test-h5-session-token-evict";
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));

    long activityId = 999L;
    H5Principal principal = new H5Principal(103L, activityId, 203L, "ACT-999", "GENERAL", "EAST", "Branch A", "Dealer A", "Dealer A Full", "139****1234");
    byte[] csrfHash = crypto.sha256("test-csrf-token");

    when(jdbc.query(anyString(), any(RowMapper.class), any())).thenAnswer(invocation -> {
      RowMapper<H5Principal> mapper = invocation.getArgument(1);
      java.sql.ResultSet rs = mock(java.sql.ResultSet.class);
      when(rs.getLong("session_id")).thenReturn(principal.sessionId());
      when(rs.getLong("activity_id")).thenReturn(principal.activityId());
      when(rs.getLong("activity_customer_id")).thenReturn(principal.customerId());
      when(rs.getString("activity_code")).thenReturn(principal.activityCode());
      when(rs.getString("customer_type")).thenReturn(principal.customerType());
      when(rs.getString("region_code")).thenReturn(principal.regionCode());
      when(rs.getString("branch_name")).thenReturn(principal.branchName());
      when(rs.getString("dealer_short_name")).thenReturn(principal.dealerShortName());
      when(rs.getString("dealer_full_name")).thenReturn(principal.dealerFullName());
      when(rs.getString("phone_masked")).thenReturn(principal.phoneMasked());
      when(rs.getBytes("csrf_token_hash")).thenReturn(csrfHash);
      return List.of(mapper.mapRow(rs, 1));
    });

    authService.requireH5(request);
    assertThat(authService.cachedH5SessionCount()).isEqualTo(1);

    // Other activity finish does not evict
    authService.evictFinishedActivitySessions(new ActivityFinishedEvent(888L, "OTHER"));
    assertThat(authService.cachedH5SessionCount()).isEqualTo(1);

    // Matching activity finish evicts
    authService.evictFinishedActivitySessions(new ActivityFinishedEvent(activityId, "ACT-999"));
    assertThat(authService.cachedH5SessionCount()).isEqualTo(0);
  }

  @Test
  void requireCsrf_reusesCsrfHashFromRequireH5WithoutQueryingDatabase() {
    String token = "test-h5-token-csrf";
    String csrf = "valid-csrf-token-xyz";

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setCookies(
        new Cookie("ORDER_SHOW_H5_SESSION", token),
        new Cookie("ORDER_SHOW_H5_CSRF", csrf)
    );
    request.addHeader("X-CSRF-Token", csrf);

    // Simulate requireH5 having run on this request
    H5Principal principal = new H5Principal(104L, 1L, 204L, "ACT-001", "GENERAL", "EAST", "Branch A", "Dealer A", "Dealer A Full", "139****1234");
    byte[] csrfHash = crypto.sha256(csrf);

    when(jdbc.query(anyString(), any(RowMapper.class), any())).thenAnswer(invocation -> {
      RowMapper<H5Principal> mapper = invocation.getArgument(1);
      java.sql.ResultSet rs = mock(java.sql.ResultSet.class);
      when(rs.getLong("session_id")).thenReturn(principal.sessionId());
      when(rs.getLong("activity_id")).thenReturn(principal.activityId());
      when(rs.getLong("activity_customer_id")).thenReturn(principal.customerId());
      when(rs.getString("activity_code")).thenReturn(principal.activityCode());
      when(rs.getString("customer_type")).thenReturn(principal.customerType());
      when(rs.getString("region_code")).thenReturn(principal.regionCode());
      when(rs.getString("branch_name")).thenReturn(principal.branchName());
      when(rs.getString("dealer_short_name")).thenReturn(principal.dealerShortName());
      when(rs.getString("dealer_full_name")).thenReturn(principal.dealerFullName());
      when(rs.getString("phone_masked")).thenReturn(principal.phoneMasked());
      when(rs.getBytes("csrf_token_hash")).thenReturn(csrfHash);
      return List.of(mapper.mapRow(rs, 1));
    });

    authService.requireH5(request);

    // Now call requireCsrf: it should validate via request attribute and NOT call queryForObject
    authService.requireCsrf(request, false);
    verify(jdbc, never()).queryForObject(anyString(), any(Class.class), any(), any());

    // Tampered CSRF header throws forbidden
    MockHttpServletRequest tamperedRequest = new MockHttpServletRequest();
    tamperedRequest.setCookies(
        new Cookie("ORDER_SHOW_H5_SESSION", token),
        new Cookie("ORDER_SHOW_H5_CSRF", "mismatched-csrf")
    );
    tamperedRequest.addHeader("X-CSRF-Token", "mismatched-csrf");
    assertThatThrownBy(() -> authService.requireCsrf(tamperedRequest, false))
        .isInstanceOf(DomainException.class);
  }
}
