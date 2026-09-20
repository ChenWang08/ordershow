package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
public class AdminDashboardController {
  private final DashboardService dashboards;
  private final ActivityService activities;
  private final AuthService auth;
  private final DepartmentAccessService access;

  public AdminDashboardController(DashboardService dashboards, ActivityService activities,
      AuthService auth, DepartmentAccessService access) {
    this.dashboards = dashboards; this.activities = activities; this.auth = auth; this.access = access;
  }

  @GetMapping("/admin/activities/{activityId}/ranking")
  ApiResponse<DashboardService.Dashboard> ranking(@PathVariable long activityId,
      @RequestParam(required = false) String customerType, HttpServletRequest request) {
    access.requireActivityAccess(auth.requireAdmin(request), activityId);
    return ApiResponse.of(dashboards.ranking(activities.byId(activityId).code(), customerType, null), TraceFilter.id(request));
  }
}
