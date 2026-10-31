package com.fengyi.ordershow.activity;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fengyi.ordershow.common.GlobalExceptionHandler;
import com.fengyi.ordershow.h5.H5AuthController;
import com.fengyi.ordershow.lottery.LotteryController;
import com.fengyi.ordershow.lottery.LotteryService;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.H5PhoneVerificationService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Uses real MVC route selection, JSON/SSE rendering and the existing missing-resource handler. */
@SpringJUnitWebConfig(ActivityRoutesTest.Config.class)
class ActivityRoutesTest {
  @Autowired WebApplicationContext context;
  @Autowired ActivityService activities;
  @Autowired AuthService auth;
  @Autowired ActivityInfoStreamService streams;
  @Autowired H5PhoneVerificationService phone;
  @Autowired LotteryService lottery;
  MockMvc mvc;

  @BeforeEach void setup() {
    reset(activities, auth, streams, phone, lottery);
    mvc = MockMvcBuilders.webAppContextSetup(context).build();
  }

  @Test void removedGetReturns404WithoutReadingActivityOrOtherServices() throws Exception {
    for (String code : List.of("EXAMPLE", "MISSING", "current-extra")) {
      mvc.perform(get("/public/activities/" + code).param("_", "123"))
          .andExpect(status().isNotFound())
          .andExpect(jsonPath("code").value("RESOURCE_NOT_FOUND"));
    }
    verifyNoInteractions(activities, auth, streams, phone, lottery);
  }

  @Test void legacyCurrentEntryAndAdminActivityReadsStillResolve() throws Exception {
    var activity = activity();
    when(activities.currentOrderable()).thenReturn(activity);
    when(activities.byId(42)).thenReturn(activity);
    mvc.perform(get("/public/activities/current"))
        .andExpect(status().isOk()).andExpect(jsonPath("data.code").value("EXAMPLE"));
    mvc.perform(get("/admin/activities/42"))
        .andExpect(status().isOk()).andExpect(jsonPath("data.id").value(42));
    mvc.perform(get("/admin/activities").param("summary", "true"))
        .andExpect(status().isOk());
    verify(activities).currentOrderable();
    verify(activities).byId(42);
    verify(activities).listSummaries(null);
    verifyNoMoreInteractions(activities);
    verifyNoInteractions(streams, phone, lottery);
  }

  @Test void publicStreamStillSendsInitialActivityWithoutTheRemovedGet() throws Exception {
    var emitter = new SseEmitter(10_000L);
    emitter.send(SseEmitter.event().name("activity").data(Map.of("version", "1", "activity", activity())));
    when(streams.subscribe("EXAMPLE")).thenReturn(emitter);
    var result = mvc.perform(get("/public/activities/EXAMPLE/events").accept("text/event-stream"))
        .andExpect(status().isOk()).andExpect(request().asyncStarted())
        .andExpect(header().string("X-Accel-Buffering", "no"))
        .andExpect(content().string(org.hamcrest.Matchers.containsString("event:activity")))
        .andExpect(content().string(org.hamcrest.Matchers.containsString("\"code\":\"EXAMPLE\"")))
        .andReturn();
    emitter.complete();
    mvc.perform(asyncDispatch(result)).andExpect(status().isOk());
    verify(streams).subscribe("EXAMPLE");
    verifyNoInteractions(activities, auth, phone, lottery);
  }

  @Test void phoneVerificationStillDispatchesToItsOwnService() throws Exception {
    when(phone.verify(eq("EXAMPLE"), isNull(), eq("13900000001"), any(), any()))
        .thenReturn(new H5PhoneVerificationService.VerificationResult(null, "fixture-csrf", false, List.of()));
    mvc.perform(post("/public/activities/EXAMPLE/verify-phone").contentType("application/json")
        .content("{\"phone\":\"13900000001\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("data.csrfToken").value("fixture-csrf"));
    verify(phone).verify(eq("EXAMPLE"), isNull(), eq("13900000001"), any(), any());
    verifyNoInteractions(activities, auth, streams, lottery);
  }

  @Test void lotteryStillUsesTheSharedActivityReader() throws Exception {
    when(activities.byCode("EXAMPLE")).thenReturn(activity());
    when(lottery.publishedRules(42)).thenReturn(List.of());
    when(lottery.publicWinners(42)).thenReturn(List.of());
    mvc.perform(get("/public/activities/EXAMPLE/lottery"))
        .andExpect(status().isOk()).andExpect(jsonPath("data.rules").isArray())
        .andExpect(jsonPath("data.winners").isArray());
    verify(activities).byCode("EXAMPLE");
    verify(lottery).publishedRules(42);
    verify(lottery).publicWinners(42);
    verifyNoInteractions(auth, streams, phone);
  }

  private static ActivityService.ActivityView activity() {
    return new ActivityService.ActivityView(42, 1, "测试部门", "EXAMPLE", "测试活动", "", "ACTIVE", "ACTIVE",
        "Asia/Shanghai", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2099-01-01T00:00:00Z"),
        Instant.parse("2099-01-02T00:00:00Z"), "ALL", 90, 30, 3, 1, List.of(), false, "TYPED",
        List.of("GENERAL"), null, null, null, null, null, null, null);
  }

  @Configuration
  @EnableWebMvc
  @Import({ActivityController.class, ActivityInfoController.class, H5AuthController.class,
      LotteryController.class, GlobalExceptionHandler.class})
  static class Config implements WebMvcConfigurer {
    @Bean ActivityService activities() { return mock(ActivityService.class); }
    @Bean AuthService auth() { return mock(AuthService.class); }
    @Bean ActivityInfoStreamService streams() { return mock(ActivityInfoStreamService.class); }
    @Bean H5PhoneVerificationService phone() { return mock(H5PhoneVerificationService.class); }
    @Bean LotteryService lottery() { return mock(LotteryService.class); }
    @Override public void addResourceHandlers(ResourceHandlerRegistry registry) {
      registry.addResourceHandler("/**").addResourceLocations("classpath:/static/");
    }
  }
}
