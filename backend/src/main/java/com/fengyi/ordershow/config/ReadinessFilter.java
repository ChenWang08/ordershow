package com.fengyi.ordershow.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ReadinessFilter extends OncePerRequestFilter {
  private final ApplicationAvailability availability;
  public ReadinessFilter(ApplicationAvailability availability) { this.availability=availability; }
  @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
      throws IOException,ServletException {
    String path=request.getRequestURI().substring(request.getContextPath().length());
    if (path.equals("/actuator/health") || path.startsWith("/actuator/health/")
        || availability.getReadinessState()==ReadinessState.ACCEPTING_TRAFFIC) {
      chain.doFilter(request,response); return;
    }
    response.setStatus(503);
    response.setHeader("Retry-After","1");
    response.setHeader("Cache-Control","no-store");
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"code\":\"SERVICE_NOT_READY\",\"message\":\"服务正在启动或停止，请稍后重试\"}");
  }
}
