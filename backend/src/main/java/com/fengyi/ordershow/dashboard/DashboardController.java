package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TraceFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/screen/activities/{activityCode}")
public class DashboardController {
  private final PageStatisticsService dashboards;
  private final ActivityService activities;
  private final RealtimeEventService events;

  public DashboardController(PageStatisticsService dashboards, ActivityService activities, RealtimeEventService events) {
    this.dashboards = dashboards; this.activities = activities; this.events = events;
  }

  @GetMapping("/ranking")
  ApiResponse<DashboardService.Dashboard> ranking(@PathVariable String activityCode,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String regionCode,
      @RequestParam(required = false) String metric,
      HttpServletRequest request) {
    return ApiResponse.of(dashboards.ranking(activityCode, customerType, regionCode, metric), TraceFilter.id(request));
  }

  @GetMapping("/dashboard")
  ApiResponse<DashboardService.Report> dashboard(@PathVariable String activityCode, HttpServletRequest request) {
    return ApiResponse.of(dashboards.dashboard(activityCode), TraceFilter.id(request));
  }

  @GetMapping("/reports/{reportCode}")
  ApiResponse<DashboardService.Report> report(@PathVariable String activityCode, @PathVariable String reportCode, HttpServletRequest request) {
    return ApiResponse.of(dashboards.reports(activityCode, reportCode), TraceFilter.id(request));
  }

  @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  SseEmitter events(@PathVariable String activityCode) {
    var activity = activities.byCode(activityCode);
    if ("FINISHED".equals(activity.status()) || "ARCHIVED".equals(activity.status())) {
      throw DomainException.conflict("ACTIVITY_HISTORY_READ_ONLY", "活动已结束，请查看历史看板");
    }
    return events.subscribe(activity.id());
  }
}
