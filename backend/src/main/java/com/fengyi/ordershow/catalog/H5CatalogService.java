package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.security.H5Principal;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class H5CatalogService {
  private final H5CatalogDataService data;
  private final H5CatalogCache cache;
  private final MeterRegistry metrics;
  private final boolean enabled;

  public H5CatalogService(H5CatalogDataService data, H5CatalogCache cache, MeterRegistry metrics,
      @Value("${H5_CATALOG_CACHE_ENABLED:true}") boolean enabled) {
    this.data = data; this.cache = cache; this.metrics = metrics; this.enabled = enabled;
  }

  public List<H5Product> products(String code, H5Principal customer, String rebate, String keyword) {
    long started = System.nanoTime();
    var timer = io.micrometer.core.instrument.Timer.start(metrics);
    try {
      var context = data.context(code, customer);
      // Preserve SQL LIKE/collation semantics for optional callers; the phone filters locally.
      if (!enabled || (rebate != null && !rebate.isEmpty()) || (keyword != null && !keyword.isEmpty())) {
        metrics.counter("order_show.h5.catalog.legacy").increment();
        return data.legacy(code, context, customer, rebate, keyword);
      }
      for (int attempt = 0; attempt < 3; attempt++) {
        var lookup = cache.lookup(context.activityId(), context.version());
        var snapshot = lookup.snapshot();
        // Recheck identity/version after an async cold load: whitelist edits can happen while waiting.
        var current = lookup.waited() || snapshot.version() != context.version() || snapshot.productVersion() != context.productVersion()
            ? data.context(code, customer) : context;
        if (snapshot.version() == current.version() && snapshot.productVersion() == current.productVersion()) {
          var filtering = io.micrometer.core.instrument.Timer.start(metrics);
          try { return snapshot.visible(current); }
          finally { filtering.stop(metrics.timer("order_show.h5.catalog.stage", "stage", "filter")); }
        }
        context = current;
      }
      throw H5CatalogCache.busy();
    } finally {
      timer.stop(metrics.timer("order_show.h5.catalog.request"));
      long elapsed = (System.nanoTime() - started) / 1_000_000;
      if (elapsed >= 1000) LoggerFactory.getLogger(getClass()).warn("Slow H5 catalog read: elapsedMs={}", elapsed);
    }
  }
}
