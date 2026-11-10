package com.fengyi.ordershow.customer;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/admin/activities/{activityId}/{kind:customers|attendees}")
public class RosterController {
  private final RosterService service;
  private final AuthService auth;
  public RosterController(RosterService service, AuthService auth) { this.service=service; this.auth=auth; }

  @GetMapping("/page")
  RosterService.RosterPage page(@PathVariable long activityId, @PathVariable String kind,
      @RequestParam(required=false) String customerType, @RequestParam(required=false) String branch,
      @RequestParam(required=false) String status, @RequestParam(required=false) String matchStatus,
      @RequestParam(required=false) String keyword, @RequestParam(defaultValue="1") int page,
      @RequestParam(defaultValue="50") int size, HttpServletRequest request) {
    auth.requireAdmin(request);
    return service.page(activityId,kind.equals("customers"),new RosterService.Filters(customerType,branch,status,matchStatus,keyword),page,size,TraceFilter.id(request));
  }
  @PostMapping("/deletion-preview")
  ApiResponse<RosterService.DeletionPreview> preview(@PathVariable long activityId, @PathVariable String kind,
      @RequestBody RosterService.Selection selection,HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.deletionPreview(activityId,kind.equals("customers"),selection),TraceFilter.id(request));
  }
  @PostMapping("/batch-delete")
  ApiResponse<Long> delete(@PathVariable long activityId, @PathVariable String kind,
      @RequestBody RosterService.Selection selection,HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.delete(activityId,kind.equals("customers"),selection),TraceFilter.id(request));
  }
}
