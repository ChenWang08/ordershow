package com.fengyi.ordershow.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.ConstraintViolationException;
import java.net.URI;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;

@RestControllerAdvice
public class GlobalExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(AsyncRequestNotUsableException.class)
  void disconnectedAsyncClient(AsyncRequestNotUsableException exception) {
    // The response is already unusable; writing ProblemDetail would produce another conversion error for SSE.
    log.debug("Async client disconnected: {}", exception.getMessage());
  }

  @ExceptionHandler(AsyncRequestTimeoutException.class)
  ResponseEntity<ProblemDetail> asyncTimeout(AsyncRequestTimeoutException exception, HttpServletRequest request,
      HttpServletResponse response) {
    String contentType = response.getContentType();
    if (contentType != null && contentType.startsWith("text/event-stream")) {
      // A finite SSE subscription ending is expected. Complete the async dispatch without a JSON body.
      log.debug("SSE subscription expired: {}", request.getRequestURI());
      return null;
    }
    return problem(HttpStatus.SERVICE_UNAVAILABLE, "ASYNC_REQUEST_TIMEOUT", "请求处理超时，请稍后重试", request, null);
  }

  @ExceptionHandler(DomainException.class)
  ResponseEntity<ProblemDetail> domain(DomainException exception, HttpServletRequest request) {
    return problem(exception.status(), exception.code(), exception.getMessage(), request, null);
  }

  @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class, ConstraintViolationException.class,
      HttpMessageNotReadableException.class})
  ResponseEntity<ProblemDetail> validation(Exception exception, HttpServletRequest request) {
    return problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "请求字段格式或内容不正确", request,
        Map.of("validation", exception.getMessage() == null ? "invalid" : exception.getMessage()));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  ResponseEntity<ProblemDetail> notFound(NoResourceFoundException exception, HttpServletRequest request) {
    return problem(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "请求的接口或资源不存在", request, null);
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ProblemDetail> unexpected(Exception exception, HttpServletRequest request) {
    log.error("Unhandled request failure", exception);
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "服务器处理失败，请稍后重试", request, null);
  }

  private ResponseEntity<ProblemDetail> problem(HttpStatus status, String code, String detail,
                                                 HttpServletRequest request, Map<String, ?> extra) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setTitle(status.getReasonPhrase());
    problem.setType(URI.create("https://order-show.local/problems/" + code.toLowerCase().replace('_', '-')));
    problem.setProperty("code", code);
    problem.setProperty("traceId", TraceFilter.id(request));
    if (extra != null) extra.forEach(problem::setProperty);
    return ResponseEntity.status(status).body(problem);
  }
}
