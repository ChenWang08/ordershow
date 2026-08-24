package com.fengyi.ordershow.audit;

import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuditController {
  private final AuditService service;
  public AuditController(AuditService service) { this.service = service; }

  @GetMapping("/admin/activities/{activityId}/audit-logs")
  PageResponse<AuditService.AuditView> list(@PathVariable long activityId,
      @RequestParam(required = false) String actionCode, @RequestParam(required = false) String objectType,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "50") int size,
      HttpServletRequest request) {
    return service.list(activityId, actionCode, objectType, page, size, TraceFilter.id(request));
  }

  @GetMapping("/admin/audit-logs")
  PageResponse<AuditService.AuditView> all(@RequestParam(required = false) Long activityId,
      @RequestParam(required = false) String actionCode, @RequestParam(required = false) String objectType,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "50") int size,
      HttpServletRequest request) {
    return service.list(activityId, actionCode, objectType, page, size, TraceFilter.id(request));
  }
}
