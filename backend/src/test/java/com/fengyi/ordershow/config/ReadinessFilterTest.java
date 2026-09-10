package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ReadinessFilterTest {
  @Test void refusesBusinessBeforeReadyAndDuringShutdown() throws Exception {
    var availability=mock(ApplicationAvailability.class);
    when(availability.getReadinessState()).thenReturn(ReadinessState.REFUSING_TRAFFIC);
    var request=new MockHttpServletRequest("PUT","/api/v1/h5/activities/A/order");request.setContextPath("/api/v1");
    var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
    new ReadinessFilter(availability).doFilter(request,response,chain);
    assertThat(response.getStatus()).isEqualTo(503);assertThat(response.getHeader("Retry-After")).isEqualTo("1");
    assertThat(response.getContentAsString()).contains("SERVICE_NOT_READY");verifyNoInteractions(chain);
  }
  @Test void healthRemainsAccessibleAndReadyBusinessContinuesThroughSecurity() throws Exception {
    var availability=mock(ApplicationAvailability.class);
    when(availability.getReadinessState()).thenReturn(ReadinessState.REFUSING_TRAFFIC);
    var filter=new ReadinessFilter(availability);
    for(String path:new String[]{"/actuator/health","/actuator/health/readiness"}) {
      var request=new MockHttpServletRequest("GET","/api/v1"+path);request.setContextPath("/api/v1");
      var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
      filter.doFilter(request,response,chain);verify(chain).doFilter(request,response);
    }
    when(availability.getReadinessState()).thenReturn(ReadinessState.ACCEPTING_TRAFFIC);
    var request=new MockHttpServletRequest("GET","/api/v1/admin/activities");request.setContextPath("/api/v1");
    var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
    filter.doFilter(request,response,chain);verify(chain).doFilter(request,response);
  }
}
