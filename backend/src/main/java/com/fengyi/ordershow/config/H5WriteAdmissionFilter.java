package com.fengyi.ordershow.config;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Keeps H5 writes from occupying every DB connection while reads are waiting. */
@Component
@Order(0) // Run after Spring Security's CORS handling, including for rejected writes.
public class H5WriteAdmissionFilter extends OncePerRequestFilter {
  private final Semaphore permits;
  private final long timeoutMs;
  private final AtomicInteger active = new AtomicInteger();
  private final AtomicInteger waiting = new AtomicInteger();

  @Autowired
  public H5WriteAdmissionFilter(@Value("${H5_WRITE_CONCURRENCY:36}") int concurrency,
      @Value("${H5_WRITE_WAIT_TIMEOUT_MS:12000}") long timeoutMs, MeterRegistry meters) {
    this(concurrency,timeoutMs);
    meters.gauge("order_show.h5.write.admission.active",active);
    meters.gauge("order_show.h5.write.admission.waiting",waiting);
  }

  H5WriteAdmissionFilter(int concurrency,long timeoutMs) {
    if(concurrency<1 || timeoutMs<1)throw new IllegalArgumentException("H5 write admission settings must be positive");
    permits=new Semaphore(concurrency,true);this.timeoutMs=timeoutMs;
  }

  @Override protected boolean shouldNotFilter(HttpServletRequest request) {
    String method=request.getMethod();
    if(!(method.equals("PUT") || method.equals("POST") || method.equals("DELETE")))return true;
    String path=request.getRequestURI().substring(request.getContextPath().length());
    return !path.matches("/h5/activities/[^/]+/(?:order(?:/withdraw)?|order-draft|order-change-requests)");
  }

  @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
      throws IOException,ServletException {
    boolean acquired=false;waiting.incrementAndGet();
    try {
      try { acquired=permits.tryAcquire(timeoutMs,TimeUnit.MILLISECONDS); }
      catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); }
      if(!acquired) {
        response.setStatus(503);response.setHeader("Retry-After","1");response.setHeader("Cache-Control","no-store");
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":\"H5_WRITE_BUSY\",\"message\":\"下单请求较多，请稍后重试\"}");
        return;
      }
      waiting.decrementAndGet();active.incrementAndGet();chain.doFilter(request,response);
    } finally {
      if(acquired){active.decrementAndGet();permits.release();}
      else waiting.decrementAndGet();
    }
  }

  int activeCount(){return active.get();}
  int waitingCount(){return waiting.get();}
  int availablePermits(){return permits.availablePermits();}
}
