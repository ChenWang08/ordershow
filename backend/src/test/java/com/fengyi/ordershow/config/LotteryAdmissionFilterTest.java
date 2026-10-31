package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.servlet.FilterChain;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class LotteryAdmissionFilterTest {
  private static MockHttpServletRequest request(String method,String suffix) {
    var r=new MockHttpServletRequest(method,"/api/v1"+suffix);r.setContextPath("/api/v1");return r;
  }
  @Test void saturatedPreviewRejectsImmediatelyButDrawAndH5RemainIndependent() throws Exception {
    var meters=new SimpleMeterRegistry();var filter=new LotteryAdmissionFilter(1,1,meters);
    mock(FilterChain.class); // Initialize Mockito before starting the bounded blocking section.
    var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
    FilterChain blocked=(q,s)->{entered.countDown();try {assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}};
    try(var pool=Executors.newSingleThreadExecutor()) {
      var first=pool.submit(()->{filter.doFilter(request("POST","/admin/activities/1/lottery/candidates/preview"),new MockHttpServletResponse(),blocked);return null;});
      assertThat(entered.await(3,TimeUnit.SECONDS)).isTrue();
      assertThat(meters.get("order_show.lottery.preview.active").gauge().value()).isEqualTo(1);
      for(var r:new MockHttpServletRequest[]{request("POST","/admin/activities/2/lottery/candidates/preview"),request("GET","/admin/activities/1/lottery/product-options")}) {
        var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);filter.doFilter(r,response,chain);
        assertThat(response.getStatus()).isEqualTo(503);assertThat(response.getHeader("Retry-After")).isEqualTo("2");
        assertThat(response.getContentAsString()).contains("LOTTERY_BUSY");verifyNoInteractions(chain);
      }
      for(var r:new MockHttpServletRequest[]{request("POST","/admin/activities/1/lottery/rounds/1/draw"),request("PUT","/h5/activities/A/order"),request("GET","/admin/activities/1/lottery/rules")}) {
        var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);filter.doFilter(r,response,chain);verify(chain).doFilter(r,response);
      }
      release.countDown();first.get(3,TimeUnit.SECONDS);
      assertThat(meters.get("order_show.lottery.preview.active").gauge().value()).isZero();
    }finally{release.countDown();}
  }
  @Test void failedDrawReleasesPermitAndActiveGauge() throws Exception {
    var meters=new SimpleMeterRegistry();var filter=new LotteryAdmissionFilter(1,1,meters);
    var r=request("POST","/admin/activities/1/lottery/rounds/1/draw");
    assertThatThrownBy(()->filter.doFilter(r,new MockHttpServletResponse(),(q,s)->{throw new IllegalStateException("test");})).isInstanceOf(IllegalStateException.class);
    assertThat(meters.get("order_show.lottery.draw.active").gauge().value()).isZero();
    var next=request("POST","/admin/activities/1/lottery/rounds/2/draw");var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
    filter.doFilter(next,response,chain);verify(chain).doFilter(next,response);
  }
}
