package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.catalog.H5CatalogDataService.*;
import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;

class H5CatalogCacheTest {
  final H5CatalogDataService data = mock(H5CatalogDataService.class);
  final SimpleMeterRegistry metrics = new SimpleMeterRegistry();
  H5CatalogCache cache(int activities, long bytes, int loads, int waiters, long waitMillis) {
    return new H5CatalogCache(data, metrics, new H5CatalogCache.Limits(activities, bytes, Duration.ofMinutes(10), loads, waiters, waitMillis));
  }
  static Snapshot snapshot(long id, long revision) { return new Snapshot(id, revision, 99, List.of(), Map.of()); }
  static void await(CountDownLatch latch) throws Exception { assertThat(latch.await(3, TimeUnit.SECONDS)).isTrue(); }

  @Test void threeHundredConcurrentCustomersShareOneLoadAndHitsDoNotReload() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    var result = snapshot(1,1);
    when(data.load(eq(1L), any(), any())).thenAnswer(call -> { entered.countDown(); await(release); return result; });
    var cache = cache(2,10000,2,400,3000);
    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
      var ready = new CountDownLatch(300); var go = new CountDownLatch(1);
      var tasks = java.util.stream.IntStream.range(0,300).mapToObj(i -> pool.submit(() -> {
        ready.countDown(); await(go); return cache.get(1,1);
      })).toList();
      await(ready); go.countDown(); await(entered); release.countDown();
      for (var task : tasks) assertThat(task.get(4,TimeUnit.SECONDS)).isSameAs(result);
      assertThat(cache.lookup(1,1).waited()).isFalse();
      verify(data).load(1,null,null); assertThat(cache.entryCount()).isEqualTo(1);
    } finally { release.countDown(); cache.close(); }
  }

  @Test void loadTimeoutDoesNotCancelSharedWorkAndNextRequestCanReuseIt() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(data.load(eq(1L),any(),any())).thenAnswer(call -> { entered.countDown(); await(release); return snapshot(1,1); });
    var cache = cache(2,10000,1,2,30);
    try {
      assertThatThrownBy(() -> cache.get(1,1)).isInstanceOf(DomainException.class);
      await(entered); release.countDown();
      long end = System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
      while (cache.entryCount()==0 && System.nanoTime()<end) Thread.onSpinWait();
      assertThat(cache.get(1,1).version()).isEqualTo(1); verify(data).load(1,null,null);
      assertThat(metrics.get("order_show.h5.catalog.waiters").gauge().value()).isZero();
    } finally { release.countDown(); cache.close(); }
  }

  @Test void activeLoadsAndWaitingRequestsAreBounded() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(data.load(eq(1L),any(),any())).thenAnswer(call -> { entered.countDown(); await(release); return snapshot(1,1); });
    var cache = cache(2,10000,1,1,3000);
    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
      var first = pool.submit(() -> cache.get(1,1)); await(entered);
      long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
      while (metrics.get("order_show.h5.catalog.waiters").gauge().value()!=1 && System.nanoTime()<end) Thread.onSpinWait();
      assertThatThrownBy(() -> cache.get(1,1)).isInstanceOf(DomainException.class);
      assertThatThrownBy(() -> cache.get(2,1)).isInstanceOf(DomainException.class);
      verify(data,never()).load(eq(2L),any(),any()); release.countDown(); first.get(3,TimeUnit.SECONDS);
    } finally { release.countDown(); cache.close(); }
  }

  @Test void lruAndOversizeDoNotRetainUnboundedCatalogs() {
    when(data.load(anyLong(),any(),any())).thenAnswer(call -> snapshot(call.getArgument(0),1));
    var cache=cache(2,1100,2,10,1000);
    try {
      cache.get(1,1); cache.get(2,1); cache.get(1,1); cache.get(3,1);
      assertThat(cache.entryCount()).isEqualTo(2); assertThat(cache.estimatedBytes()).isLessThanOrEqualTo(1100);
      cache.get(2,1); verify(data,times(2)).load(eq(2L),any(),any());
    } finally { cache.close(); }
    var tiny=cache(2,1,1,1,1000);
    try { tiny.get(1,1); assertThat(tiny.entryCount()).isZero(); assertThat(tiny.estimatedBytes()).isZero(); }
    finally { tiny.close(); }
  }

  @Test void failedLoadReleasesCapacityAndCanRetry() {
    when(data.load(eq(1L),any(),any())).thenThrow(new IllegalStateException("offline")).thenReturn(snapshot(1,1));
    var cache=cache(1,10000,1,2,1000);
    try {
      assertThatThrownBy(() -> cache.get(1,1)).isInstanceOf(IllegalStateException.class);
      assertThat(cache.get(1,1).version()).isEqualTo(1);
      assertThat(metrics.get("order_show.h5.catalog.active_loads").gauge().value()).isZero();
    } finally { cache.close(); }
  }

  @Test void duplicateOldEventsAreIgnoredAndWarmChangesRefreshIncrementally() throws Exception {
    var updated = new CountDownLatch(1);
    when(data.load(eq(1L),any(),any())).thenReturn(snapshot(1,1)).thenAnswer(call -> { updated.countDown(); return snapshot(1,2); });
    var cache=cache(2,10000,2,10,1000);
    try {
      cache.changed(new Change(999,2,2,Set.of(4L),false)); verifyNoInteractions(data);
      cache.get(1,1); var change=new Change(1,2,2,Set.of(4L),false); cache.changed(change); await(updated);
      assertThat(cache.get(1,2).version()).isEqualTo(2);
      cache.changed(change); cache.changed(new Change(1,1,1,Set.of(5L),false));
      verify(data).load(eq(1L),argThat(base -> base!=null && base.version()==1),eq(change)); verify(data,times(2)).load(anyLong(),any(),any());
    } finally { cache.close(); }
  }

  @Test void reconnectDoesNotReinsertThePreviouslyRunningSnapshot() throws Exception {
    var entered=new CountDownLatch(1); var release=new CountDownLatch(1);
    when(data.load(eq(1L),any(),any())).thenAnswer(call -> { entered.countDown(); await(release); return snapshot(1,1); });
    var cache=cache(2,10000,1,5,3000);
    try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
      var pending=pool.submit(() -> cache.get(1,1)); await(entered); cache.resynchronize(); release.countDown();
      pending.get(3,TimeUnit.SECONDS); assertThat(cache.entryCount()).isZero();
      cache.get(1,1); verify(data,times(2)).load(1,null,null);
    } finally { release.countDown(); cache.close(); }
  }

  @Test void eventMergingRequiresContiguousCoverageAndCapsProductIds() {
    var a=new Change(1,2,2,Set.of(1L),false); var b=new Change(1,3,3,Set.of(2L),false);
    assertThat(H5CatalogCache.merge(b,a)).isEqualTo(new Change(1,2,3,Set.of(1L,2L),false));
    assertThat(H5CatalogCache.merge(a,new Change(1,4,4,Set.of(3L),false)).fullReload()).isTrue();
    var ids=java.util.stream.LongStream.rangeClosed(1,500).boxed().collect(java.util.stream.Collectors.toSet());
    assertThat(H5CatalogCache.merge(new Change(1,2,2,ids,false),new Change(1,3,3,Set.of(501L),false)).fullReload()).isTrue();
  }
}
