package com.fengyi.ordershow.activity;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.SubscriptionListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

/** Broadcasts committed public snapshots to every replica; subscriber recovery reads current state. */
@Component
public class ActivityInfoRedisBridge implements MessageListener, SubscriptionListener, DisposableBean, SmartLifecycle {
  static final String CHANNEL = "order-show:activity-info:v1";
  private static final Logger LOG = LoggerFactory.getLogger(ActivityInfoRedisBridge.class);
  private final String channel;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final ActivityInfoSnapshotService snapshots;
  private final ActivityInfoStreamService streams;
  private final RedisMessageListenerContainer listener = new RedisMessageListenerContainer();
  private final AtomicBoolean failed = new AtomicBoolean();
  private volatile boolean stopped;
  private volatile boolean running;
  private Thread starter;

  public ActivityInfoRedisBridge(StringRedisTemplate redis, RedisConnectionFactory connections, ObjectMapper json,
      ActivityInfoSnapshotService snapshots, ActivityInfoStreamService streams) { this(redis, connections, json, snapshots, streams, CHANNEL); }

  @org.springframework.beans.factory.annotation.Autowired
  public ActivityInfoRedisBridge(StringRedisTemplate redis, RedisConnectionFactory connections, ObjectMapper json,
      ActivityInfoSnapshotService snapshots, ActivityInfoStreamService streams,
      @org.springframework.beans.factory.annotation.Value("${ACTIVITY_INFO_CHANNEL:${REALTIME_CHANNEL:order-show:local:events}:activity-info:v1}") String channel) {
    this.channel = channel;
    this.redis = redis; this.json = json; this.snapshots = snapshots; this.streams = streams;
    listener.setConnectionFactory(connections);
    listener.setRecoveryInterval(5000);
    listener.addMessageListener(this, new ChannelTopic(channel));
    listener.setErrorHandler(error -> LOG.warn("Activity info subscription error: {}", error.getClass().getSimpleName()));
  }

  @PostConstruct void initialize() { listener.afterPropertiesSet(); }

  @Override public synchronized void start() {
    if (running) return;
    stopped = false; running = true;
    // Redis being temporarily unavailable must not prevent the application or initial snapshots from loading.
    starter = Thread.ofVirtual().name("activity-info-redis-start").start(() -> {
      while (!stopped) {
        try { listener.start(); return; }
        catch (RuntimeException error) {
          if (failed.compareAndSet(false, true)) LOG.warn("Activity info Redis unavailable; delivery remains retryable");
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

  public void forward(long activityId) {
    try {
      var snapshot = snapshots.load(activityId);
      Long receivers = redis.convertAndSend(channel, json.writeValueAsString(snapshot));
      if (receivers == null || receivers == 0) throw new IllegalStateException("No activity info Redis subscriber");
      failed.set(false);
    } catch (Exception error) {
      if (failed.compareAndSet(false, true)) LOG.warn("Activity info publish failed; retaining its outbox entries for retry");
      throw new IllegalStateException("Activity info delivery unavailable", error);
    }
  }

  @Override public void onMessage(Message message, byte[] pattern) {
    try { streams.broadcast(json.readValue(message.getBody(), ActivityInfoSnapshotService.Snapshot.class)); }
    catch (Exception error) { LOG.warn("Rejected invalid activity info message: {}", error.getClass().getSimpleName()); }
  }

  @Override public void onChannelSubscribed(byte[] channel, long count) {
    failed.set(false);
    streams.resynchronize();
  }

  @Override public void destroy() throws Exception {
    stop();
    listener.destroy();
  }
}
