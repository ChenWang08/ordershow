package com.fengyi.ordershow.catalog;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.H5CatalogDataService.Change;
import jakarta.annotation.PostConstruct;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.connection.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

/** Internal catalog invalidation only. No products are pushed to browsers or editing carts. */
@Component
public class ProductCatalogRedisBridge implements MessageListener, SubscriptionListener, DisposableBean, SmartLifecycle {
  static final String CHANNEL = "order-show:product-catalog:v1";
  private static final Logger LOG = LoggerFactory.getLogger(ProductCatalogRedisBridge.class);
  private final String channel;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final H5CatalogCache cache;
  private final RedisMessageListenerContainer listener = new RedisMessageListenerContainer();
  private final AtomicBoolean failed = new AtomicBoolean();
  private volatile boolean stopped;
  private volatile boolean running;
  private volatile long retryAt;
  private int failures;
  private Thread starter;

  public ProductCatalogRedisBridge(StringRedisTemplate redis, RedisConnectionFactory connections,
      ObjectMapper json, H5CatalogCache cache) { this(redis, connections, json, cache, CHANNEL); }

  @org.springframework.beans.factory.annotation.Autowired
  public ProductCatalogRedisBridge(StringRedisTemplate redis, RedisConnectionFactory connections,
      ObjectMapper json, H5CatalogCache cache,
      @org.springframework.beans.factory.annotation.Value("${H5_CATALOG_CHANNEL:${REALTIME_CHANNEL:order-show:local:events}:product-catalog:v1}") String channel) {
    this.channel = channel;
    this.redis = redis; this.json = json; this.cache = cache;
    listener.setConnectionFactory(connections); listener.setRecoveryInterval(5000);
    listener.addMessageListener(this, new ChannelTopic(channel));
    listener.setErrorHandler(error -> LOG.warn("Catalog subscription error: {}", error.getClass().getSimpleName()));
  }

  @PostConstruct void initialize() { listener.afterPropertiesSet(); }
  @Override public synchronized void start() {
    if (running) return;
    stopped = false; running = true;
    starter = Thread.ofVirtual().name("product-catalog-redis-start").start(() -> {
      while (!stopped) {
        try { listener.start(); return; }
        catch (RuntimeException error) {
          if (failed.compareAndSet(false, true)) LOG.warn("Catalog Redis unavailable; DB revision checks remain active");
          try { Thread.sleep(5000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
        }
      }
    });
  }
  @Override public boolean isRunning() { return running; }
  @Override public int getPhase() { return Integer.MAX_VALUE; }
  @Override public void stop() {
    stopped = true; running = false;
    if (starter != null) starter.interrupt();
    listener.stop();
  }

  public void forward(Change change) {
    cache.changed(change);
    long retry = retryAt;
    if (retry != 0 && System.nanoTime() - retry < 0) throw new IllegalStateException("Catalog delivery is backing off");
    try {
      Long receivers = redis.convertAndSend(channel, json.writeValueAsString(change));
      if (receivers == null || receivers == 0) throw new IllegalStateException("No catalog subscriber");
      recovered();
    } catch (Exception error) {
      synchronized (this) {
        long seconds = 1L << failures;
        failures = Math.min(failures + 1, 5);
        retryAt = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(Math.min(seconds, 30));
      }
      if (failed.compareAndSet(false, true)) LOG.warn("Catalog publish failed; retaining its outbox entries for retry");
      throw new IllegalStateException("Catalog delivery unavailable", error);
    }
  }

  @Override public void onMessage(Message message, byte[] pattern) {
    try {
      var change = json.readValue(message.getBody(), Change.class);
      if (change.activityId() <= 0 || change.fromVersion() <= 0 || change.toVersion() < change.fromVersion()
          || change.productIds().size() > ProductCatalogChanges.MAX_PRODUCT_IDS
          || change.productIds().stream().anyMatch(id -> id <= 0)) throw new IllegalArgumentException("Invalid catalog change");
      cache.changed(change);
    } catch (Exception error) { LOG.warn("Rejected invalid catalog message: {}", error.getClass().getSimpleName()); }
  }
  private synchronized void recovered() { failures = 0; retryAt = 0; failed.set(false); }
  @Override public void onChannelSubscribed(byte[] channel, long count) { recovered(); cache.resynchronize(); }
  @Override public void destroy() throws Exception { stop(); listener.destroy(); }
}
