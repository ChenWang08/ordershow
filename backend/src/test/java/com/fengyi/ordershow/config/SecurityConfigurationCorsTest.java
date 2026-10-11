package com.fengyi.ordershow.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.DefaultCorsProcessor;

class SecurityConfigurationCorsTest {
  private static final String LOCAL_ORIGIN = "http://localhost:3000";
  private static final String REMOTE_ORIGIN = "http://192.168.1.10:3000";
  private static final String MULTIPLE_ORIGINS = " " + LOCAL_ORIGIN + ", , " + REMOTE_ORIGIN + " ,";

  @Test
  void singleOriginRemainsCompatible() throws IOException {
    assertAllowed(preflight(LOCAL_ORIGIN, LOCAL_ORIGIN), LOCAL_ORIGIN);
  }

  @ParameterizedTest
  @ValueSource(strings = {LOCAL_ORIGIN, REMOTE_ORIGIN})
  void allowsEachConfiguredOriginWithWhitespaceAndEmptyEntries(String origin) throws IOException {
    var response = preflight(MULTIPLE_ORIGINS, origin);
    assertAllowed(response, origin);
    assertTrue(response.getHeader("Access-Control-Allow-Methods").contains("POST"));
    assertEquals("Content-Type, X-CSRF-Token", response.getHeader("Access-Control-Allow-Headers"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"http://untrusted.example:3000", "http://localhost:3001", "null"})
  void rejectsUnlistedOrigins(String origin) throws IOException {
    var response = preflight(MULTIPLE_ORIGINS, origin);
    assertEquals(403, response.getStatus());
    assertNull(response.getHeader("Access-Control-Allow-Origin"));
    assertNull(response.getHeader("Access-Control-Allow-Credentials"));
  }

  @Test
  void emptyConfigurationDoesNotAllowArbitraryOrigins() throws IOException {
    var response = preflight(" , , ", LOCAL_ORIGIN);
    assertEquals(403, response.getStatus());
    assertNull(response.getHeader("Access-Control-Allow-Origin"));
  }

  @Test
  void actualRequestAllowsCredentialsForRemoteOrigin() throws IOException {
    var request = request("GET", REMOTE_ORIGIN);
    var response = process(MULTIPLE_ORIGINS, request);
    assertAllowed(response, REMOTE_ORIGIN);
    assertTrue(response.getHeader("Access-Control-Expose-Headers").contains("X-Request-Id"));
  }

  private static MockHttpServletResponse preflight(String configuredOrigins, String origin) throws IOException {
    var request = request("OPTIONS", origin);
    request.addHeader("Access-Control-Request-Method", "POST");
    request.addHeader("Access-Control-Request-Headers", "Content-Type, X-CSRF-Token");
    return process(configuredOrigins, request);
  }

  private static MockHttpServletRequest request(String method, String origin) {
    var request = new MockHttpServletRequest(method, "/api/v1/admin/auth/login");
    request.setContextPath("/api/v1");
    request.setServerName("192.168.1.10");
    request.setServerPort(8080);
    request.addHeader("Origin", origin);
    return request;
  }

  private static MockHttpServletResponse process(String configuredOrigins, MockHttpServletRequest request)
      throws IOException {
    var properties = mock(OrderShowProperties.class);
    when(properties.publicOrigin()).thenReturn(configuredOrigins);
    var security = new SecurityConfiguration(null, properties, null, null, null);
    var configuration = security.corsConfigurationSource().getCorsConfiguration(request);
    assertNotNull(configuration);
    var response = new MockHttpServletResponse();
    new DefaultCorsProcessor().processRequest(configuration, request, response);
    return response;
  }

  private static void assertAllowed(MockHttpServletResponse response, String origin) {
    assertEquals(200, response.getStatus());
    assertEquals(origin, response.getHeader("Access-Control-Allow-Origin"));
    assertEquals("true", response.getHeader("Access-Control-Allow-Credentials"));
  }
}
