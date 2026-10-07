package com.fengyi.ordershow.customer;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CustomerController {
  private final CustomerService service;
  private final AuthService auth;

  public CustomerController(CustomerService service, AuthService auth) { this.service = service; this.auth = auth; }

  @GetMapping({"/admin/activities/{activityId}/customers", "/admin/activities/{activityId}/orders/customer-options"})
  PageResponse<CustomerService.CustomerView> customers(@PathVariable long activityId,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String regionCode,
      @RequestParam(required = false) String keyword,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size, HttpServletRequest request) {
    return service.customers(activityId, customerType, regionCode, keyword, page, size, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/customers")
  ApiResponse<CustomerService.CustomerView> addCustomer(@PathVariable long activityId,
      @RequestBody CustomerService.CustomerWrite body, HttpServletRequest request) {
    auth.requireAdmin(request);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.addCustomer(activityId, body), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}/customers/{customerId}")
  ApiResponse<CustomerService.CustomerView> updateCustomer(@PathVariable long activityId, @PathVariable long customerId,
      @RequestBody CustomerService.CustomerWrite body, HttpServletRequest request) {
    auth.requireAdmin(request);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.updateCustomer(activityId, customerId, body), TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/customers/{customerId}")
  ApiResponse<Boolean> deleteCustomer(@PathVariable long activityId, @PathVariable long customerId,
      @RequestHeader("If-Match") String ifMatch, HttpServletRequest request) {
    auth.requireAdmin(request);
    service.deleteCustomer(activityId, customerId, Integer.parseInt(ifMatch.replace("\"", "")));
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/attendees")
  PageResponse<CustomerService.AttendeeView> attendees(@PathVariable long activityId,
      @RequestParam(required = false) String matchStatus, @RequestParam(required = false) String keyword, @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "20") int size, HttpServletRequest request) {
    return service.attendees(activityId, matchStatus, keyword, page, size, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/attendees")
  ApiResponse<CustomerService.AttendeeView> addAttendee(@PathVariable long activityId,
      @RequestBody CustomerService.AttendeeWrite body, HttpServletRequest request) {
    return ApiResponse.of(service.addAttendee(activityId, body, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}/attendees/{attendeeId}")
  ApiResponse<CustomerService.AttendeeView> updateAttendee(@PathVariable long activityId, @PathVariable long attendeeId,
      @RequestBody CustomerService.AttendeeWrite body, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.updateAttendee(activityId, attendeeId, body), TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/attendees/{attendeeId}")
  ApiResponse<Boolean> deleteAttendee(@PathVariable long activityId, @PathVariable long attendeeId, HttpServletRequest request) {
    auth.requireAdmin(request); service.deleteAttendee(activityId, attendeeId);
    return ApiResponse.of(true, TraceFilter.id(request));
  }
}
