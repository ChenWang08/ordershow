package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
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
  private final AuthService auth;

  public OrderController(OrderService service, AuthService auth) { this.service = service; this.auth = auth; }

  @GetMapping("/h5/activities/{activityCode}/order")
  ApiResponse<OrderService.OrderView> current(@PathVariable String activityCode, HttpServletRequest request) {
    return ApiResponse.of(service.current(activityCode, auth.requireH5(request)), TraceFilter.id(request));
  }

  @PutMapping("/h5/activities/{activityCode}/order")
  ApiResponse<OrderService.OrderView> submit(@PathVariable String activityCode, @RequestBody OrderService.SubmitRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    return ApiResponse.of(service.submit(activityCode, auth.requireH5(request), body, idempotencyKey, TraceFilter.id(request)), TraceFilter.id(request));
  }

  @PostMapping("/h5/activities/{activityCode}/order/withdraw")
  ApiResponse<OrderService.OrderView> withdraw(@PathVariable String activityCode, @RequestBody OrderService.WithdrawRequest body,
      @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
    return ApiResponse.of(service.withdraw(activityCode, auth.requireH5(request), body.expectedVersion(), idempotencyKey, TraceFilter.id(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders")
  PageResponse<OrderService.OrderSummary> orders(@PathVariable long activityId, @RequestParam(required = false) String status,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String keyword,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size, HttpServletRequest request) {
    return service.adminOrders(activityId, status, customerType, keyword, page, size, TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/orders/{orderId}")
  ApiResponse<OrderService.OrderView> order(@PathVariable long activityId, @PathVariable long orderId, HttpServletRequest request) {
    return ApiResponse.of(service.adminOrder(activityId, orderId), TraceFilter.id(request));
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
