package com.fengyi.ordershow.config;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Acquire before entering transactional services; expensive previews cannot queue for DB connections. */
@Component
@Order(1)
public class LotteryAdmissionFilter extends OncePerRequestFilter {
  private final Semaphore previews;
  private final Semaphore draws;
  private final AtomicInteger activePreviews = new AtomicInteger();
  private final AtomicInteger activeDraws = new AtomicInteger();

  public LotteryAdmissionFilter(@Value("${LOTTERY_PREVIEW_CONCURRENCY:2}") int previewLimit,
      @Value("${LOTTERY_DRAW_CONCURRENCY:1}") int drawLimit, MeterRegistry meters) {
    if (previewLimit < 1 || drawLimit < 1) throw new IllegalArgumentException("Lottery concurrency must be positive");
    previews = new Semaphore(previewLimit); draws = new Semaphore(drawLimit);
    meters.gauge("order_show.lottery.preview.active", activePreviews);
    meters.gauge("order_show.lottery.draw.active", activeDraws);
  }
  @Override protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI().substring(request.getContextPath().length());
    return !(request.getMethod().equals("POST") && path.matches("/admin/activities/\\d+/lottery/(?:candidates/preview|rounds/\\d+/draw)")
        || request.getMethod().equals("GET") && path.matches("/admin/activities/\\d+/lottery/product-options"));
  }
  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    boolean draw = request.getRequestURI().endsWith("/draw");
    Semaphore permits = draw ? draws : previews;
    AtomicInteger active = draw ? activeDraws : activePreviews;
    if (!permits.tryAcquire()) {
      response.setStatus(503); response.setHeader("Retry-After", "2"); response.setHeader("Cache-Control", "no-store");
      response.setContentType("application/json;charset=UTF-8");
      response.getWriter().write("{\"code\":\"LOTTERY_BUSY\",\"message\":\"抽奖查询或开奖正在处理中，请稍后重试\"}");
      return;
    }
    active.incrementAndGet();
    try { chain.doFilter(request, response); }
    finally { active.decrementAndGet(); permits.release(); }
  }
}
