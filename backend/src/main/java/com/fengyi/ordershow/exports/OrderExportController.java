package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.storage.StorageService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/admin/activities/{activityId}/exports")
public class OrderExportController {
  private final ExportRepository tasks;
  private final ExportPolicy policy;
  private final AuthService auth;
  private final StorageService storage;
  public OrderExportController(ExportRepository tasks,ExportPolicy policy,AuthService auth,StorageService storage) {
    this.tasks=tasks;this.policy=policy;this.auth=auth;this.storage=storage;
  }
  private void authorize(long activity,HttpServletRequest request) {
    ExportPolicy.requireAdmin(auth.requireAdmin(request));policy.requireActivity(activity,false);
  }
  @PostMapping
  ResponseEntity<ApiResponse<TaskView>> create(@PathVariable long activityId,@RequestHeader(value="Idempotency-Key",required=false) String key,
      @RequestBody CreateRequest body,HttpServletRequest request) {
    authorize(activityId,request);
    if(body==null || !"ORDER_PACKAGE".equals(body.exportType())) throw DomainException.badRequest("EXPORT_TYPE_INVALID","请选择订单CSV压缩包导出");
    Task task=tasks.create(activityId,body.filters()==null?new Filters(null,null,null):body.filters(),key,auth.requireAdmin(request));
    return ResponseEntity.status(HttpStatus.ACCEPTED).body(ApiResponse.of(TaskView.of(task),TraceFilter.id(request)));
  }
  @GetMapping
  ApiResponse<List<TaskView>> list(@PathVariable long activityId,HttpServletRequest request) {
    authorize(activityId,request);return ApiResponse.of(tasks.list(activityId).stream().map(TaskView::of).toList(),TraceFilter.id(request));
  }
  @GetMapping("/{taskId}")
  ApiResponse<TaskView> get(@PathVariable long activityId,@PathVariable long taskId,HttpServletRequest request) {
    authorize(activityId,request);return ApiResponse.of(TaskView.of(tasks.task(activityId,taskId)),TraceFilter.id(request));
  }
  @PostMapping("/{taskId}/cancel")
  ApiResponse<TaskView> cancel(@PathVariable long activityId,@PathVariable long taskId,HttpServletRequest request) {
    ExportPolicy.requireAdmin(auth.requireAdmin(request));
    tasks.task(activityId,taskId);tasks.cancel(activityId,taskId);
    return ApiResponse.of(TaskView.of(tasks.task(activityId,taskId)),TraceFilter.id(request));
  }
  @GetMapping("/{taskId}/download")
  ResponseEntity<InputStreamResource> download(@PathVariable long activityId,@PathVariable long taskId,HttpServletRequest request)throws Exception {
    authorize(activityId,request);Task task=tasks.task(activityId,taskId);policy.requireTask(task);
    if(!"COMPLETED".equals(task.status()) || task.fileId()==null || task.expiresAt()==null || !task.expiresAt().isAfter(Instant.now()))
      throw DomainException.conflict("EXPORT_NOT_DOWNLOADABLE","文件未完成或已过期，请重新生成");
    var meta=storage.meta(task.fileId());
    var input=storage.openExport(meta);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/zip")).contentLength(meta.sizeBytes())
        .header(HttpHeaders.CACHE_CONTROL,"no-store")
        .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(meta.filename(),StandardCharsets.UTF_8).build().toString())
        .body(new InputStreamResource(input));
  }
}
