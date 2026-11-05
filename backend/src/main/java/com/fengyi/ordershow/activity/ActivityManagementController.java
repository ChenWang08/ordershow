package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
public class ActivityManagementController {
  private final ActivityLifecycleManagement management;
  private final AuthService auth;
  public ActivityManagementController(ActivityLifecycleManagement management,AuthService auth){this.management=management;this.auth=auth;}

  @PostMapping("/admin/activities/{activityId}/archive")
  ApiResponse<ActivityService.ActivityView> archive(@PathVariable long activityId,@RequestHeader("If-Match") int version,
      @Valid @RequestBody Reason body,HttpServletRequest request){
    var result=management.archive(activityId,version,body.reason(),auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  @PostMapping("/admin/activities/{activityId}/unarchive")
  ApiResponse<ActivityService.ActivityView> unarchive(@PathVariable long activityId,@RequestHeader("If-Match") int version,
      @Valid @RequestBody Reason body,HttpServletRequest request){
    var result=management.unarchive(activityId,version,body.reason(),auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  @GetMapping("/admin/activities/{activityId}/deletion-preview")
  ApiResponse<ActivityLifecycleManagement.DeletionPreview> preview(@PathVariable long activityId,HttpServletRequest request){
    return ApiResponse.of(management.preview(activityId,auth.requireAdmin(request)),TraceFilter.id(request));
  }
  @PostMapping("/admin/activities/{activityId}/permanent-deletion")
  @ResponseStatus(HttpStatus.ACCEPTED)
  ApiResponse<ActivityLifecycleManagement.DeletionTask> delete(@PathVariable long activityId,@RequestHeader("If-Match") int version,
      @Valid @RequestBody Delete body,HttpServletRequest request){
    var result=management.delete(activityId,version,body.code(),body.reason(),auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  @GetMapping("/admin/activity-deletion-tasks")
  ApiResponse<java.util.List<ActivityLifecycleManagement.DeletionTask>> tasks(@RequestParam(defaultValue="1") int page,HttpServletRequest request){
    return ApiResponse.of(management.tasks(auth.requireAdmin(request),page),TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-deletion-tasks/{taskId}/retry")
  ApiResponse<ActivityLifecycleManagement.DeletionTask> retry(@PathVariable long taskId,HttpServletRequest request){
    var result=management.retry(taskId,auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-deletion-tasks/{taskId}/pause")
  ApiResponse<ActivityLifecycleManagement.DeletionTask> pause(@PathVariable long taskId,HttpServletRequest request){
    var result=management.pause(taskId,auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-deletion-tasks/{taskId}/resume")
  ApiResponse<ActivityLifecycleManagement.DeletionTask> resume(@PathVariable long taskId,HttpServletRequest request){
    var result=management.resume(taskId,auth.requireAdmin(request)); recorded(request);
    return ApiResponse.of(result,TraceFilter.id(request));
  }
  private static void recorded(HttpServletRequest request){request.setAttribute(AuditService.RECORDED_REQUEST_ATTRIBUTE,true);}
  public record Reason(@NotBlank @Size(max=500) String reason){}
  public record Delete(@NotBlank String code,@NotBlank @Size(max=500) String reason){}
}
