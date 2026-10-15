package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/admin/activities/{activityId}/backgrounds/{kind}")
public class ActivityBackgroundController {
  private final ActivityBackgroundService service;
  private final AuthService auth;
  public ActivityBackgroundController(ActivityBackgroundService service, AuthService auth) {
    this.service = service; this.auth = auth;
  }
  @PostMapping(consumes = "multipart/form-data")
  ApiResponse<ActivityService.ActivityView> upload(@PathVariable long activityId, @PathVariable String kind,
      @RequestParam("file") MultipartFile file, HttpServletRequest request) {
    return ApiResponse.of(service.update(activityId, kind, file, auth.requireAdmin(request)), TraceFilter.id(request));
  }
  @DeleteMapping
  ApiResponse<ActivityService.ActivityView> reset(@PathVariable long activityId, @PathVariable String kind,
      HttpServletRequest request) {
    return ApiResponse.of(service.update(activityId, kind, null, auth.requireAdmin(request)), TraceFilter.id(request));
  }
}
