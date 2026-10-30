package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PageStatisticsControllerTest {
  @Test void publicRoutesDispatchOnlyToTheirDedicatedReader() throws Exception {
    var pages = mock(PageStatisticsService.class);
    var activities = mock(ActivityService.class);
    var events = mock(RealtimeEventService.class);
    var mvc = MockMvcBuilders.standaloneSetup(new DashboardController(pages, activities, events)).build();
    mvc.perform(get("/screen/activities/example/ranking").param("customerType", "GENERAL")
        .param("regionCode", "NORTH").param("metric", "TONS")).andExpect(status().isOk());
    mvc.perform(get("/screen/activities/example/dashboard")).andExpect(status().isOk());
    mvc.perform(get("/screen/activities/example/reports/OVERALL")).andExpect(status().isOk());
    verify(pages).ranking("example", "GENERAL", "NORTH", "TONS");
    verify(pages).dashboard("example");
    verify(pages).reports("example", "OVERALL");
    verifyNoMoreInteractions(pages);
    verifyNoInteractions(activities, events);
  }

  @Test void overviewChecksDepartmentAccessAndNeverCallsLegacyRanking() throws Exception {
    var pages = mock(PageStatisticsService.class);
    var legacy = mock(DashboardService.class);
    var activities = mock(ActivityService.class);
    var auth = mock(AuthService.class);
    var access = mock(DepartmentAccessService.class);
    var admin = mock(AdminPrincipal.class);
    when(auth.requireAdmin(any())).thenReturn(admin);
    var controller = new AdminDashboardController(legacy, activities, auth, access, pages);
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    mvc.perform(get("/admin/activities/123/overview")).andExpect(status().isOk());
    var order = inOrder(auth, access, pages);
    order.verify(auth).requireAdmin(any());
    order.verify(access).requireActivityAccess(admin, 123);
    order.verify(pages).overview(123);
    verifyNoInteractions(legacy, activities);
    clearInvocations(pages);
    doThrow(DomainException.forbidden("ACTIVITY_FORBIDDEN", "无权访问"))
        .when(access).requireActivityAccess(admin, 456);
    assertThatThrownBy(() -> controller.overview(456, new MockHttpServletRequest())).isInstanceOf(DomainException.class);
    verifyNoInteractions(pages);
  }
}
