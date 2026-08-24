package com.fengyi.ordershow.imports;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/admin/activities/{activityId}/imports")
public class ImportController {
  private final ImportService service;
  private final AuthService auth;
  private final ActivityService activities;

  public ImportController(ImportService service, AuthService auth, ActivityService activities) {
    this.service = service;
    this.auth = auth;
    this.activities = activities;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  ApiResponse<ImportService.ImportTask> upload(@PathVariable long activityId,
      @RequestParam String importType, @RequestParam MultipartFile file, HttpServletRequest request) {
    var activity = activities.byId(activityId);
    if ("ACTIVE".equals(activity.status()) || "CLOSED".equals(activity.status())) {
      throw com.fengyi.ordershow.common.DomainException.conflict("BULK_IMPORT_LOCKED", "活动开始后不能批量导入");
    }
    return ApiResponse.of(service.upload(activityId, importType, file, auth.requireAdmin(request).id()), TraceFilter.id(request));
  }

  @GetMapping
  ApiResponse<List<ImportService.ImportTask>> tasks(@PathVariable long activityId, HttpServletRequest request) {
    return ApiResponse.of(service.tasks(activityId), TraceFilter.id(request));
  }

  @GetMapping("/{taskId}")
  ApiResponse<ImportService.ImportTask> task(@PathVariable long activityId, @PathVariable long taskId, HttpServletRequest request) {
    ImportService.ImportTask task = service.task(taskId);
    requireActivity(activityId, task);
    return ApiResponse.of(task, TraceFilter.id(request));
  }

  @GetMapping("/{taskId}/rows")
  ApiResponse<List<ImportService.StagingRow>> rows(@PathVariable long activityId, @PathVariable long taskId,
      @RequestParam(required = false) String validationStatus, HttpServletRequest request) {
    requireActivity(activityId, service.task(taskId));
    return ApiResponse.of(service.rows(taskId, validationStatus), TraceFilter.id(request));
  }

  @PatchMapping("/{taskId}/rows/{rowId}")
  ApiResponse<Boolean> updateRow(@PathVariable long activityId, @PathVariable long taskId, @PathVariable long rowId,
      @RequestBody RowPatch body, HttpServletRequest request) {
    requireActivity(activityId, service.task(taskId));
    service.updateRow(taskId, rowId, body.changes(), body.deleted(), auth.requireAdmin(request).id());
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @GetMapping("/{taskId}/errors")
  ApiResponse<List<ImportService.ImportIssue>> errors(@PathVariable long activityId, @PathVariable long taskId, HttpServletRequest request) {
    requireActivity(activityId, service.task(taskId));
    return ApiResponse.of(service.issues(taskId), TraceFilter.id(request));
  }

  @PostMapping("/{taskId}/confirm")
  @ResponseStatus(HttpStatus.ACCEPTED)
  ApiResponse<ImportService.ImportTask> confirm(@PathVariable long activityId, @PathVariable long taskId, HttpServletRequest request) {
    requireActivity(activityId, service.task(taskId));
    return ApiResponse.of(service.confirm(taskId, auth.requireAdmin(request).id()), TraceFilter.id(request));
  }

  @DeleteMapping("/{taskId}")
  ApiResponse<Boolean> cancel(@PathVariable long activityId, @PathVariable long taskId, HttpServletRequest request) {
    requireActivity(activityId, service.task(taskId));
    service.cancel(taskId);
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  private static void requireActivity(long activityId, ImportService.ImportTask task) {
    if (task.activityId() != activityId) throw com.fengyi.ordershow.common.DomainException.notFound("IMPORT_TASK_NOT_FOUND", "导入任务不存在");
  }

  public record RowPatch(Map<String, Object> changes, boolean deleted) {}
}
