package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
  private final OrderService service;
  private final OrderDraftService drafts;
  private final AuthService auth;

  public OrderController(OrderService service, OrderDraftService drafts, AuthService auth) {
    this.service = service;
    this.drafts = drafts;
    this.auth = auth;
  }

  @GetMapping("/h5/activities/{activityCode}/order-draft")
  ApiResponse<OrderDraftService.DraftView> currentDraft(@PathVariable String activityCode, HttpServletRequest request) {
    return ApiResponse.of(drafts.current(activityCode, auth.requireH5(request)), TraceFilter.id(request));
  }

  @PutMapping("/h5/activities/{activityCode}/order-draft")
  ApiResponse<OrderDraftService.DraftView> saveDraft(@PathVariable String activityCode,
      @RequestBody OrderDraftService.SaveDraftRequest body, HttpServletRequest request) {
    return ApiResponse.of(drafts.save(activityCode, auth.requireH5(request), body), TraceFilter.id(request));
  }

  @DeleteMapping("/h5/activities/{activityCode}/order-draft")
  ApiResponse<Boolean> deleteDraft(@PathVariable String activityCode, @RequestParam long customerId,
      HttpServletRequest request) {
    return ApiResponse.of(drafts.delete(activityCode, auth.requireH5(request), customerId), TraceFilter.id(request));
  }

  @GetMapping("/h5/activities/{activityCode}/order")
  ApiResponse<OrderService.OrderView> current(@PathVariable String activityCode,
      @RequestParam(defaultValue = "true") boolean includeHistory, HttpServletRequest request) {
    return ApiResponse.of(service.current(activityCode, auth.requireH5(request), includeHistory), TraceFilter.id(request));
  }

  @PutMapping("/h5/activities/{activityCode}/order")
  ApiResponse<OrderService.OrderView> submit(@PathVariable String activityCode, @RequestBody OrderService.SubmitRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, @RequestParam(defaultValue = "true") boolean includeHistory, HttpServletRequest request) {
    return ApiResponse.of(service.submit(activityCode, auth.requireH5(request), body, idempotencyKey, TraceFilter.id(request), includeHistory), TraceFilter.id(request));
  }

  @PostMapping("/h5/activities/{activityCode}/order/withdraw")
  ApiResponse<OrderService.OrderView> withdraw(@PathVariable String activityCode, @RequestBody OrderService.WithdrawRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, @RequestParam(defaultValue = "true") boolean includeHistory, HttpServletRequest request) {
    return ApiResponse.of(service.withdraw(activityCode, auth.requireH5(request), body.expectedVersion(), idempotencyKey, TraceFilter.id(request), includeHistory), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders")
  PageResponse<OrderService.OrderSummary> orders(@PathVariable long activityId, @RequestParam(required = false) String status,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String keyword,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size, HttpServletRequest request) {
    return service.adminOrders(activityId, status, customerType, keyword, page, size, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/orders/preview")
  ApiResponse<OrderService.OrderPreview> preview(@PathVariable long activityId,
      @RequestBody OrderService.AdminPreviewRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.adminPreview(activityId, body, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/orders")
  ApiResponse<OrderService.AdminOrderView> createOrder(@PathVariable long activityId,
      @RequestBody OrderService.AdminCreateRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.adminCreate(activityId, body, auth.requireAdmin(request), idempotencyKey,
        TraceFilter.id(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders/{orderId}")
  ApiResponse<OrderService.AdminOrderView> order(@PathVariable long activityId, @PathVariable long orderId, HttpServletRequest request) {
    return ApiResponse.of(service.adminOrder(activityId, orderId), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}/orders/{orderId}")
  ApiResponse<OrderService.AdminOrderView> adjustOrder(@PathVariable long activityId, @PathVariable long orderId,
      @RequestBody OrderService.AdminAdjustRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.adminAdjust(activityId, orderId, body, auth.requireAdmin(request), idempotencyKey,
        TraceFilter.id(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/orders/{orderId}/void")
  ApiResponse<OrderService.AdminOrderView> voidOrder(@PathVariable long activityId, @PathVariable long orderId,
      @RequestBody OrderService.AdminVoidRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.adminVoid(activityId, orderId, body, auth.requireAdmin(request), idempotencyKey,
        TraceFilter.id(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders/{orderId}/versions")
  ApiResponse<List<OrderService.OrderVersionView>> versions(@PathVariable long activityId, @PathVariable long orderId, HttpServletRequest request) {
    return ApiResponse.of(service.versions(activityId, orderId), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders/{orderId}/operations")
  ApiResponse<List<OrderService.OperationView>> operations(@PathVariable long activityId, @PathVariable long orderId, HttpServletRequest request) {
    return ApiResponse.of(service.operations(activityId, orderId), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders/export")
  ResponseEntity<byte[]> export(@PathVariable long activityId, @RequestParam(required = false) String status,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String keyword) {
    byte[] content = service.export(activityId, status, customerType, keyword);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename("orders.xlsx").build().toString()).body(content);
  }
}
