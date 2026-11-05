package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class H5CustomerWriteRateLimiterTest {
  private H5CustomerWriteRateLimiter limiter(H5CustomerWriteRateLimiter.Store store, boolean enabled, long budget) {
    return new H5CustomerWriteRateLimiter(store, new SimpleMeterRegistry(), enabled, 10_000, 3, 20, budget, 5000);
  }
  private static void check(H5CustomerWriteRateLimiter limiter, String endpoint, String key, boolean replay) {
    limiter.check(7, 9, endpoint, key, new byte[]{1,2,3}, replay);
  }

  @Test void replicasAndEndpointsUseTheSameCustomerNamespaceAndNeverExposeRawKeys() {
    var calls=new ArrayList<List<Object>>();
    H5CustomerWriteRateLimiter.Store store=(prefix,member,hash,replay,window,ops,requests)->{
      synchronized(calls){calls.add(List.of(prefix,member,hash,replay,window,ops,requests));}
      return new H5CustomerWriteRateLimiter.Decision(1,0);
    };
    var first=limiter(store,true,1000);var second=limiter(store,true,1000);
    try {
      check(first,"ORDER_SUBMIT","private-command",false);
      check(second,"ORDER_CHANGE_REQUEST","private-command",true);
      second.check(7,10,"ORDER_SUBMIT","other",new byte[]{1},false);
      second.check(8,9,"ORDER_SUBMIT","other",new byte[]{1},false);
      assertEquals(calls.get(0).get(0),calls.get(1).get(0));
      assertNotEquals(calls.get(0).get(0),calls.get(2).get(0));
      assertNotEquals(calls.get(0).get(0),calls.get(3).get(0));
      assertFalse(calls.get(0).get(1).toString().contains("private-command"));
      assertEquals(true,calls.get(1).get(3));assertEquals(3,calls.get(0).get(5));assertEquals(20,calls.get(0).get(6));
    }finally{first.close();second.close();}
  }

  @Test void rejectsWith429AndRoundsTheRetryTimeUp() {
    var limiter=limiter((a,b,c,d,e,f,g)->new H5CustomerWriteRateLimiter.Decision(0,1201),true,1000);
    try {
      var error=assertThrows(H5WriteRateLimitException.class,()->check(limiter,"ORDER_SUBMIT","key",false));
      assertEquals(429,error.status().value());assertEquals("H5_WRITE_RATE_LIMITED",error.code());assertEquals(2,error.retryAfterSeconds());
    }finally{limiter.close();}
  }

  @Test void changedFingerprintRemainsAnIdempotencyConflict() {
    var limiter=limiter((a,b,c,d,e,f,g)->new H5CustomerWriteRateLimiter.Decision(-1,0),true,1000);
    try{assertEquals("IDEMPOTENCY_KEY_REUSED",assertThrows(DomainException.class,()->check(limiter,"ORDER_SUBMIT","key",false)).code());}
    finally{limiter.close();}
  }

  @Test void disabledProtectionDoesNotCallRedis() {
    var limiter=limiter((a,b,c,d,e,f,g)->{throw new AssertionError("No Redis when disabled");},false,200);
    try{check(limiter,"ORDER_SUBMIT","key",false);}finally{limiter.close();}
  }

  @Test void timedOutRedisChecksDegradeWithinBudgetAndDoNotKeepRetrying() throws Exception {
    var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var calls=new AtomicInteger();
    var limiter=limiter((a,b,c,d,e,f,g)->{
      calls.incrementAndGet();entered.countDown();
      try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}
      return new H5CustomerWriteRateLimiter.Decision(1,0);
    },true,30);
    try {
      long start=System.nanoTime();check(limiter,"ORDER_SUBMIT","key",false);
      assertTrue(entered.await(1,TimeUnit.SECONDS));
      assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)<1000);
      for(int i=0;i<20;i++)check(limiter,"ORDER_SUBMIT","key"+i,false);
      assertEquals(1,calls.get());
    }finally{release.countDown();limiter.close();}
  }

  @Test void aBurstDuringRedisFailureHasBoundedWorkersAndCancelledQueuedChecks() throws Exception {
    var release=new CountDownLatch(1);var active=new AtomicInteger();var max=new AtomicInteger();var calls=new AtomicInteger();
    var limiter=limiter((a,b,c,d,e,f,g)->{
      calls.incrementAndGet();int count=active.incrementAndGet();max.accumulateAndGet(count,Math::max);
      try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}
      finally{active.decrementAndGet();}
      return new H5CustomerWriteRateLimiter.Decision(1,0);
    },true,30);
    try(var clients=Executors.newVirtualThreadPerTaskExecutor()) {
      var tasks=new ArrayList<Future<?>>();
      for(int i=0;i<80;i++)tasks.add(clients.submit(()->check(limiter,"ORDER_SUBMIT","key",false)));
      for(var task:tasks)task.get(2,TimeUnit.SECONDS);
      assertTrue(max.get()<=4);release.countDown();
      limiter.close();assertTrue(calls.get()<=4,"Expired queued checks must not be sent after recovery");
    }finally{release.countDown();limiter.close();}
  }

  @Test void redisErrorsOpenTheCircuitInsteadOfFailingOrders() {
    var calls=new AtomicInteger();
    var limiter=limiter((a,b,c,d,e,f,g)->{calls.incrementAndGet();throw new IllegalStateException("synthetic Redis outage");},true,1000);
    try{check(limiter,"ORDER_SUBMIT","key",false);check(limiter,"ORDER_SUBMIT","next",false);assertEquals(1,calls.get());}
    finally{limiter.close();}
  }

  @Test void interruptingTheCallerDoesNotContinueWithAnOrderWrite() throws Exception {
    var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var result=new AtomicReference<Throwable>();
    var limiter=limiter((a,b,c,d,e,f,g)->{
      entered.countDown();try{release.await(2,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}
      return new H5CustomerWriteRateLimiter.Decision(1,0);
    },true,1000);
    try {
      var caller=Thread.ofVirtual().start(()->{try{check(limiter,"ORDER_SUBMIT","key",false);}catch(Throwable error){result.set(error);}});
      assertTrue(entered.await(1,TimeUnit.SECONDS));caller.interrupt();caller.join(1500);
      assertInstanceOf(DomainException.class,result.get());assertEquals("H5_WRITE_BUSY",((DomainException)result.get()).code());
    }finally{release.countDown();limiter.close();}
  }
}
