package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ActivityController {
  private final ActivityService service;
  private final AuthService auth;

  public ActivityController(ActivityService service, AuthService auth) {
    this.service = service;
    this.auth = auth;
  }

  @GetMapping("/public/activities/{activityCode}")
  ApiResponse<ActivityService.ActivityView> publicActivity(@PathVariable String activityCode, HttpServletRequest request) {
    return ApiResponse.of(service.byCode(activityCode), TraceFilter.id(request));
  }

  @GetMapping("/public/activities/current")
  ApiResponse<ActivityService.ActivityView> currentPublicActivity(HttpServletRequest request) {
    return ApiResponse.of(service.currentOrderable(), TraceFilter.id(request));
  }

  @GetMapping(value = "/admin/activities", params = "!summary")
  ApiResponse<List<ActivityService.ActivityView>> activities(HttpServletRequest request) {
    return ApiResponse.of(service.list(auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @GetMapping(value = "/admin/activities", params = "summary=true")
  ApiResponse<List<ActivityService.ActivitySummary>> activitySummaries(HttpServletRequest request) {
    return ApiResponse.of(service.listSummaries(auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities")
  ApiResponse<ActivityService.ActivityView> create(@Valid @RequestBody ActivityRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.create(body.toWrite(), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}")
  ApiResponse<ActivityService.ActivityView> activity(@PathVariable long activityId, HttpServletRequest request) {
    return ApiResponse.of(service.byId(activityId), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}")
  ApiResponse<ActivityService.ActivityView> update(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, @Valid @RequestBody ActivityRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.update(activityId, parseVersion(ifMatch), body.toWrite(), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/publish")
  ApiResponse<ActivityService.ActivityView> publish(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, HttpServletRequest request) {
    return ApiResponse.of(service.publish(activityId, parseVersion(ifMatch), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/withdraw-publication")
  ApiResponse<ActivityService.ActivityView> withdrawPublication(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, HttpServletRequest request) {
    return ApiResponse.of(service.withdrawPublication(activityId, parseVersion(ifMatch), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/close")
  ApiResponse<ActivityService.ActivityView> close(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, @Valid @RequestBody CloseRequest body, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason().trim());
    return ApiResponse.of(service.closeNow(activityId, parseVersion(ifMatch), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/finish")
  ApiResponse<ActivityService.ActivityView> finish(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, @Valid @RequestBody CloseRequest body, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason().trim());
    return ApiResponse.of(service.finishNow(activityId, parseVersion(ifMatch), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PatchMapping("/admin/activities/{activityId}/live-room")
  ApiResponse<ActivityService.ActivityView> updateLiveRoom(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, @Valid @RequestBody LiveRoomRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.updateLiveRoom(activityId, parseVersion(ifMatch), body.liveRoomUrl(),
        auth.requireAdmin(request)), TraceFilter.id(request));
  }

  public record LiveRoomRequest(@Size(max = 2048) String liveRoomUrl) {}

  @PostMapping("/admin/activities/{activityId}/reopen")
  ApiResponse<ActivityService.ActivityView> reopen(@PathVariable long activityId,
      @RequestHeader("If-Match") String ifMatch, @Valid @RequestBody ReopenRequest body, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason().trim());
    var result = service.reopen(activityId, parseVersion(ifMatch), body.endsAt(), body.eventEndsAt(),
        body.reason(), TraceFilter.id(request), auth.requireAdmin(request));
    request.setAttribute(AuditService.RECORDED_REQUEST_ATTRIBUTE, true);
    return ApiResponse.of(result, TraceFilter.id(request));
  }

  public record ReopenRequest(@NotNull Instant endsAt, @NotNull Instant eventEndsAt,
                             @NotBlank @Size(max = 500) String reason) {}

  private static int parseVersion(String value) {
    return Integer.parseInt(value.replace("W/", "").replace("\"", "").trim());
  }

  public record RegionRequest(@NotBlank @Size(max = 64) String code, @NotBlank @Size(max = 100) String name, int sortNo) {}
  public record ActivityRequest(@Size(max = 64) String code, @NotBlank @Size(max = 200) String name,
      @Size(max = 2000) String description, @NotBlank String timezone, @NotNull Instant startsAt, @NotNull Instant endsAt,
      @NotNull Instant eventEndsAt,
      @NotBlank String customerScope, @Min(1) @Max(500) int companyRankingTopN,
      @Min(1) @Max(500) int branchRankingTopN, int tonDisplayScale,
      List<RegionRequest> regions, Long departmentId) {
    ActivityService.ActivityWrite toWrite() {
      return new ActivityService.ActivityWrite(code, name, description, timezone, startsAt, endsAt, eventEndsAt, customerScope,
          companyRankingTopN, branchRankingTopN, tonDisplayScale,
          regions == null ? List.of() : regions.stream().map(r -> new ActivityService.RegionWrite(r.code(), r.name(), r.sortNo())).toList(),
          departmentId);
    }
  }
  public record CloseRequest(@NotBlank @Size(max = 500) String reason) {}
}
