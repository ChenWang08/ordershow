package com.fengyi.ordershow.activity.copy;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
public class ActivityCopyController {
  private final ActivityCopyService copies;
  private final ActivityCopyWorker worker;
  private final AuthService auth;
  public ActivityCopyController(ActivityCopyService copies,ActivityCopyWorker worker,AuthService auth){this.copies=copies;this.worker=worker;this.auth=auth;}
  @GetMapping("/admin/activity-copy-sources")
  ApiResponse<List<ActivityCopyService.Source>> sources(@RequestParam long departmentId,HttpServletRequest request){
    return ApiResponse.of(copies.sources(departmentId,auth.requireAdmin(request)),TraceFilter.id(request));
  }
  @GetMapping("/admin/activities/{activityId}/copy-preview")
  ApiResponse<ActivityCopyService.Preview> preview(@PathVariable long activityId,@RequestParam long departmentId,HttpServletRequest request){
    return ApiResponse.of(copies.preview(activityId,departmentId,auth.requireAdmin(request)),TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-copies")
  ApiResponse<ActivityCopyService.Task> create(@Valid @RequestBody Create body,HttpServletRequest request){
    var activity=new ActivityService.ActivityWrite(null,body.name().trim(),"","Asia/Shanghai",body.startsAt(),body.endsAt(),body.eventEndsAt(),"ALL",90,30,3,List.of(),body.departmentId());
    var task=copies.enqueue(new ActivityCopyService.Request(activity,body.sourceId(),body.sourceStamp(),body.selection(),body.requestKey()),auth.requireAdmin(request));
    worker.wake();return ApiResponse.of(task,TraceFilter.id(request));
  }
  @GetMapping("/admin/activity-copies/{taskId}")
  ApiResponse<ActivityCopyService.Task> task(@PathVariable long taskId,HttpServletRequest request){
    var task=copies.task(taskId,auth.requireAdmin(request));if(List.of("QUEUED","RUNNING").contains(task.status()))worker.wake();
    return ApiResponse.of(task,TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-copies/{taskId}/retry")
  ApiResponse<ActivityCopyService.Task> retry(@PathVariable long taskId,HttpServletRequest request){
    var task=copies.retry(taskId,auth.requireAdmin(request));worker.wake();return ApiResponse.of(task,TraceFilter.id(request));
  }
  @PostMapping("/admin/activity-copies/{taskId}/discard")
  ApiResponse<Boolean> discard(@PathVariable long taskId,HttpServletRequest request){copies.discard(taskId,auth.requireAdmin(request));return ApiResponse.of(true,TraceFilter.id(request));}
  public record Create(@NotBlank @Size(max=200) String name,@NotNull Instant startsAt,@NotNull Instant endsAt,@NotNull Instant eventEndsAt,Long departmentId,
      @Positive long sourceId,@NotBlank String sourceStamp,@NotNull @Valid CopySnapshot.Selection selection,@NotBlank @Size(max=64) String requestKey){}
}
