package com.fengyi.ordershow.order;

import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderChangeRequestController {
  private final OrderService orders;
  private final AuthService auth;
  private final DepartmentAccessService access;
  private final OrderChangeRequestRepository requests;
  private final H5CustomerWriteGuard writeGuard;

  public OrderChangeRequestController(OrderService orders, AuthService auth, DepartmentAccessService access, OrderChangeRequestRepository requests, H5CustomerWriteGuard writeGuard) {
    this.requests = requests;
    this.writeGuard = writeGuard;
    this.orders = orders;
    this.auth = auth;
    this.access = access;
  }

  @GetMapping("/admin/activities/{activityId}/order-change-requests/page")
  com.fengyi.ordershow.common.PageResponse<java.util.Map<String,Object>> page(@PathVariable long activityId,
      @RequestParam(defaultValue="PENDING") String status, @RequestParam(defaultValue="ALL") String type,
      @RequestParam(defaultValue="") String keyword, @RequestParam(defaultValue="1") int page,
      @RequestParam(defaultValue="20") int size, @RequestParam(defaultValue="false") boolean newest, HttpServletRequest request) {
    access.requireActivityAccess(auth.requireAdmin(request),activityId);
    if (!List.of("PENDING","APPROVED","REJECTED","ALL").contains(status) || !List.of("MODIFY","WITHDRAW","ALL").contains(type))
      throw DomainException.badRequest("INVALID_FILTER","筛选条件无效");
    return requests.page(activityId,status,type,keyword,Math.max(1,page),Math.min(50,Math.max(1,size)),newest,TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/order-change-requests/pending")
  ApiResponse<List<java.util.Map<String,Object>>> pending(@PathVariable long activityId,HttpServletRequest request) {
    access.requireActivityAccess(auth.requireAdmin(request),activityId);
    return ApiResponse.of(requests.pending(activityId),TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/order-change-requests/{requestId}")
  ApiResponse<OrderService.ChangeRequestView> detail(@PathVariable long activityId,@PathVariable long requestId,HttpServletRequest request) {
    access.requireActivityAccess(auth.requireAdmin(request),activityId);
    return ApiResponse.of(orders.changeRequestDetail(activityId,requestId),TraceFilter.id(request));
  }

  @PostMapping("/h5/activities/{activityCode}/order-change-requests")
  ApiResponse<OrderService.ChangeRequestView> create(@PathVariable String activityCode,
      @RequestBody OrderService.ChangeRequestRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey,
      @RequestHeader(value = "X-H5-Customer-Id", required = false) Long expectedCustomerId,
      HttpServletRequest request) {
    var customer = auth.requireH5(request);
    if (expectedCustomerId != null && expectedCustomerId.longValue() != customer.customerId()) {
      throw DomainException.forbidden("H5_CUSTOMER_CHANGED", "客户身份已变化，请重新验证原客户后提交变更");
    }
    writeGuard.changeRequest(activityCode, customer, body, idempotencyKey);
    return ApiResponse.of(orders.createH5ChangeRequest(activityCode, customer, body, idempotencyKey, TraceFilter.id(request)), TraceFilter.id(request));
  }

  @GetMapping("/h5/activities/{activityCode}/order-change-requests/current")
  ApiResponse<OrderService.ChangeRequestView> current(@PathVariable String activityCode, HttpServletRequest request) {
    return ApiResponse.of(orders.currentH5ChangeRequest(activityCode, auth.requireH5(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/order-change-requests")
  ApiResponse<List<OrderService.ChangeRequestView>> list(@PathVariable long activityId,
      @RequestParam(required = false, defaultValue = "PENDING") String status, HttpServletRequest request) {
    access.requireActivityAccess(auth.requireAdmin(request), activityId);
    return ApiResponse.of(orders.adminChangeRequests(activityId, status), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/order-change-requests/{requestId}/approve")
  ApiResponse<OrderService.ChangeRequestView> approve(@PathVariable long activityId, @PathVariable long requestId,
      @RequestBody(required = false) OrderService.ChangeRequestReviewRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    var admin = auth.requireAdmin(request);
    access.requireActivityAccess(admin, activityId);
    String reason = body == null ? null : body.reason();
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, reason);
    return ApiResponse.of(orders.approveChangeRequest(activityId, requestId, reason, admin, idempotencyKey, TraceFilter.id(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/order-change-requests/{requestId}/reject")
  ApiResponse<OrderService.ChangeRequestView> reject(@PathVariable long activityId, @PathVariable long requestId,
      @RequestBody OrderService.ChangeRequestReviewRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    var admin = auth.requireAdmin(request);
    access.requireActivityAccess(admin, activityId);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body == null ? null : body.reason());
    return ApiResponse.of(orders.rejectChangeRequest(activityId, requestId, body == null ? null : body.reason(), admin,
        idempotencyKey, TraceFilter.id(request)), TraceFilter.id(request));
  }
}
