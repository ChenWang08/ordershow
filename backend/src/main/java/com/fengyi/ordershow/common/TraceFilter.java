package com.fengyi.ordershow.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class TraceFilter extends OncePerRequestFilter {
  public static final String ATTRIBUTE = "orderShowTraceId";

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String traceId = request.getHeader("X-Request-Id");
    if (traceId == null || !traceId.matches("[A-Za-z0-9._:-]{8,64}")) traceId = UUID.randomUUID().toString();
    request.setAttribute(ATTRIBUTE, traceId);
    response.setHeader("X-Request-Id", traceId);
    MDC.put("traceId", traceId);
    try {
      chain.doFilter(request, response);
    } finally {
      MDC.remove("traceId");
    }
  }

  public static String id(HttpServletRequest request) {
    Object value = request.getAttribute(ATTRIBUTE);
    return value == null ? "unknown" : value.toString();
  }
}
