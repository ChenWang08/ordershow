package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
  @Test void optionsKeepExplicitNullFieldsEvenWithApplicationNonNullSerialization() throws Exception {
    var rankings=mock(RankingService.class);
    when(rankings.options(eq("example"),any(RankingFilter.class))).thenReturn(new RankingStore.Options(
        java.util.List.of(new RankingStore.CustomerOption("SPECIAL",null,"未填写")),
        java.util.List.of(new RankingStore.ProductOption(null,null))));
    var mapper=new com.fasterxml.jackson.databind.ObjectMapper()
        .setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
    var mvc=MockMvcBuilders.standaloneSetup(new DashboardController(mock(PageStatisticsService.class),mock(ActivityService.class),mock(RealtimeEventService.class),rankings))
        .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(mapper)).build();
    var result=mvc.perform(get("/screen/activities/example/ranking/options")).andExpect(status().isOk()).andReturn();
    var data=mapper.readTree(result.getResponse().getContentAsString()).path("data");
    assertThat(data.path("customers").get(0).has("regionCode")).isTrue();
    assertThat(data.path("customers").get(0).path("regionCode").isNull()).isTrue();
    assertThat(data.path("products").get(0).has("productLine")).isTrue();
    assertThat(data.path("products").get(0).has("varietyName")).isTrue();
  }

  @Test void publicRoutesDispatchOnlyToTheirDedicatedReader() throws Exception {
    var pages = mock(PageStatisticsService.class);
    var activities = mock(ActivityService.class);
    var events = mock(RealtimeEventService.class);
    var rankings = mock(RankingService.class);
    var mvc = MockMvcBuilders.standaloneSetup(new DashboardController(pages, activities, events, rankings)).build();
    mvc.perform(get("/screen/activities/example/ranking").param("customerType", "GENERAL")
        .param("regionCode", "NORTH").param("metric", "TONS")).andExpect(status().isOk());
    mvc.perform(get("/screen/activities/example/dashboard")).andExpect(status().isOk());
    mvc.perform(get("/screen/activities/example/reports/OVERALL")).andExpect(status().isOk());
    verify(rankings).ranking("example", new RankingFilter("GENERAL", "NORTH", false, null, false, null, false, DashboardService.RankingMetric.TONS));
    mvc.perform(get("/screen/activities/example/ranking/options")).andExpect(status().isOk());
    verify(rankings).options("example",new RankingFilter(null,null,false,null,false,null,false,null));
    mvc.perform(get("/screen/activities/example/ranking/options").param("customerType","SPECIAL").param("regionUnassigned","true")).andExpect(status().isOk());
    verify(rankings).options("example",new RankingFilter("SPECIAL",null,true,null,false,null,false,null));
    mvc.perform(get("/screen/activities/example/ranking").param("varieties", "品种,A", "品种B"))
        .andExpect(status().isOk());
    verify(rankings).ranking("example", new RankingFilter(null, null, false, null, false, java.util.List.of("品种,A", "品种B"), false, DashboardService.RankingMetric.AMOUNT));
    mvc.perform(post("/screen/activities/example/ranking").contentType("application/json")
        .content("{\"productLine\":\"项目A\",\"varieties\":[\"品种,A\",\"品种B\"],\"includeUnspecifiedVariety\":true,\"metric\":\"TONS\"}"))
        .andExpect(status().isOk());
    verify(rankings).ranking("example", new RankingFilter(null, null, false, "项目A", false, java.util.List.of("品种,A", "品种B"), true, DashboardService.RankingMetric.TONS));
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
