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
  private final int maxWaiters;
  private final AtomicInteger active = new AtomicInteger();
  private final AtomicInteger waiting = new AtomicInteger();

  @Autowired
  public H5WriteAdmissionFilter(@Value("${H5_WRITE_CONCURRENCY:36}") int concurrency,
      @Value("${H5_WRITE_MAX_WAITERS:50}") int maxWaiters,
      @Value("${H5_WRITE_WAIT_TIMEOUT_MS:12000}") long timeoutMs, MeterRegistry meters) {
    this(concurrency,maxWaiters,timeoutMs);
    meters.gauge("order_show.h5.write.admission.active",active);
    meters.gauge("order_show.h5.write.admission.waiting",waiting);
  }

  H5WriteAdmissionFilter(int concurrency,long timeoutMs) {
    this(concurrency,50,timeoutMs);
  }

  H5WriteAdmissionFilter(int concurrency,int maxWaiters,long timeoutMs) {
    if(concurrency<1 || maxWaiters<0 || timeoutMs<1)throw new IllegalArgumentException("Invalid H5 write admission settings");
    permits=new Semaphore(concurrency,true);this.maxWaiters=maxWaiters;this.timeoutMs=timeoutMs;
  }

  @Override protected boolean shouldNotFilter(HttpServletRequest request) {
    String method=request.getMethod();
    if(!(method.equals("PUT") || method.equals("POST") || method.equals("DELETE")))return true;
    String path=request.getRequestURI().substring(request.getContextPath().length());
    return !path.matches("/h5/activities/[^/]+/(?:order(?:/withdraw)?|order-draft|order-change-requests)");
  }

  @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
      throws IOException,ServletException {
    boolean acquired=false,queued=false;
    try {
      try {
        // The timed zero-wait acquisition respects the semaphore's existing fairness.
        acquired=permits.tryAcquire(0,TimeUnit.MILLISECONDS);
        if(!acquired) {
          for(int count=waiting.get();count<maxWaiters;count=waiting.get()) {
            if(waiting.compareAndSet(count,count+1)){queued=true;break;}
          }
          if(queued)acquired=permits.tryAcquire(timeoutMs,TimeUnit.MILLISECONDS);
        }
      }
      catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); }
      if(!acquired) {
        response.setStatus(503);response.setHeader("Retry-After","1");response.setHeader("Cache-Control","no-store");
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":\"H5_WRITE_BUSY\",\"message\":\"下单请求较多，请稍后重试\"}");
        return;
      }
      if(queued){waiting.decrementAndGet();queued=false;}
      active.incrementAndGet();chain.doFilter(request,response);
    } finally {
      if(queued)waiting.decrementAndGet();
      if(acquired){active.decrementAndGet();permits.release();}
    }
  }

  int activeCount(){return active.get();}
  int waitingCount(){return waiting.get();}
  int availablePermits(){return permits.availablePermits();}
}
