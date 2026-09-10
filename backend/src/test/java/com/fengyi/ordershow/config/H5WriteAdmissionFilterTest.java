package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class H5WriteAdmissionFilterTest {
  private static MockHttpServletRequest request(String method,String path) {
    var request=new MockHttpServletRequest(method,"/api/v1"+path);request.setContextPath("/api/v1");return request;
  }
  @Test void readsAndUnrelatedWritesBypassAdmission() throws Exception {
    var filter=new H5WriteAdmissionFilter(1,100);var chain=mock(jakarta.servlet.FilterChain.class);
    for(var request:new MockHttpServletRequest[]{request("GET","/h5/activities/A/order"),request("PUT","/admin/activities/1")}) {
      var response=new MockHttpServletResponse();filter.doFilter(request,response,chain);verify(chain).doFilter(request,response);
    }
    assertThat(filter.availablePermits()).isEqualTo(1);
  }
  @Test void boundsWritesAndReleasesPermitAfterCompletion() throws Exception {
    var filter=new H5WriteAdmissionFilter(1,3000);var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
    var firstChain=mock(jakarta.servlet.FilterChain.class);
    doAnswer(call->{entered.countDown();assertThat(release.await(3,TimeUnit.SECONDS)).isTrue();return null;})
        .when(firstChain).doFilter(any(),any());
    try(var pool=Executors.newFixedThreadPool(2)) {
      var first=pool.submit(()->{filter.doFilter(request("PUT","/h5/activities/A/order"),new MockHttpServletResponse(),firstChain);return null;});
      assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();
      var secondChain=mock(jakarta.servlet.FilterChain.class);
      var second=pool.submit(()->{filter.doFilter(request("PUT","/h5/activities/A/order-draft"),new MockHttpServletResponse(),secondChain);return null;});
      long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
      while(filter.waitingCount()!=1 && System.nanoTime()<deadline)Thread.sleep(5);
      assertThat(filter.activeCount()).isEqualTo(1);assertThat(filter.waitingCount()).isEqualTo(1);
      verifyNoInteractions(secondChain);release.countDown();first.get(3,TimeUnit.SECONDS);second.get(3,TimeUnit.SECONDS);
      verify(secondChain).doFilter(any(),any());assertThat(filter.activeCount()).isZero();
      assertThat(filter.waitingCount()).isZero();assertThat(filter.availablePermits()).isEqualTo(1);
    }finally{release.countDown();}
  }
  @Test void timeoutReturnsRetryable503WithoutLeakingPermit() throws Exception {
    var filter=new H5WriteAdmissionFilter(1,20);var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
    var firstChain=mock(jakarta.servlet.FilterChain.class);
    doAnswer(call->{entered.countDown();release.await(3,TimeUnit.SECONDS);return null;}).when(firstChain).doFilter(any(),any());
    try(var pool=Executors.newSingleThreadExecutor()) {
      var first=pool.submit(()->{filter.doFilter(request("POST","/h5/activities/A/order/withdraw"),new MockHttpServletResponse(),firstChain);return null;});
      assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();var response=new MockHttpServletResponse();
      var rejected=mock(jakarta.servlet.FilterChain.class);filter.doFilter(request("DELETE","/h5/activities/A/order-draft"),response,rejected);
      assertThat(response.getStatus()).isEqualTo(503);assertThat(response.getContentAsString()).contains("H5_WRITE_BUSY");
      verifyNoInteractions(rejected);release.countDown();first.get(3,TimeUnit.SECONDS);
      assertThat(filter.availablePermits()).isEqualTo(1);assertThat(filter.waitingCount()).isZero();
    }finally{release.countDown();}
  }
}
