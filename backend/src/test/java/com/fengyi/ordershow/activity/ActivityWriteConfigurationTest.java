package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.servlet.HandlerMapping;

class ActivityWriteConfigurationTest {
  @ParameterizedTest
  @CsvSource(textBlock="""
      POST, /admin/activities/7/lottery/candidates/preview, false, true, false, true
      POST, /admin/activities/7/orders/preview, false, true, false, true
      POST, /admin/activities/7/order-change-requests/9/approve, false, false, false, true
      POST, /admin/activities/7/order-change-requests/9/reject, false, false, false, true
      PUT, /h5/activities/ACT7/order, false, false, false, true
      POST, /h5/activities/ACT7/order-change-requests, false, false, false, true
      POST, /h5/activities/ACT7/order/withdraw, false, false, false, true
      POST, /screen/activities/ACT7/ranking, false, true, false, true
      POST, /admin/activities/7/orders, false, false, false, false
      PUT, /admin/activities/7/orders/9, false, false, false, false
      POST, /admin/activities/7/orders/9/void, false, false, false, false
      POST, /admin/activities/7/lottery/rounds/9/draw, false, false, false, false
      POST, /admin/activities/7/lottery/rounds/9/reset, false, false, false, false
      POST, /admin/activities/7/lottery/rules, false, false, false, false
      POST, /admin/activities/7/archive, true, false, false, false
      POST, /admin/activities/7/unarchive, true, false, false, false
      POST, /admin/activities/7/permanent-deletion, true, false, true, false
      POST, /admin/activities/7/exports, false, true, false, false
      POST, /admin/activities/7/exports/9/cancel, false, true, false, false
      PUT, /admin/activities/7/orders/preview, false, true, false, false
      POST, /admin/activities/7/order-change-requests/9/approve/extra, false, false, false, false
      POST, /admin/activities/7/lottery/candidates/preview/extra, false, false, false, false
      """)
  void onlyExplicitPostEntrypointsShareTheActivityLock(String method, String path, boolean lifecycle,
      boolean allowArchiveRead, boolean repeatedDelete, boolean shared) {
    var policy = mock(ActivityAccessPolicy.class);
    when(policy.readableCode("ACT7")).thenReturn(7L);
    var manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    var factory = new ProxyFactory(new Endpoint());
    factory.setProxyTargetClass(true);
    factory.addAdvisor(new ActivityWriteConfiguration().activityWriteAdvisor(policy, manager));
    var request = new MockHttpServletRequest(method, "/api/v1"+path);
    request.setContextPath("/api/v1");
    request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,
        path.contains("ACT7") ? Map.of("activityCode", "ACT7") : Map.of("activityId", "7"));
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    try {
      assertThat(((Endpoint) factory.getProxy()).invoke()).isEqualTo("ok");
      verify(policy).lockWrite(7L, lifecycle, allowArchiveRead, repeatedDelete, shared);
      verify(manager).commit(any());
      verify(manager, never()).rollback(any());
    } finally { RequestContextHolder.resetRequestAttributes(); }
  }

  @RestController
  static class Endpoint {
    @PostMapping("/probe") public String invoke() { return "ok"; }
  }
}
