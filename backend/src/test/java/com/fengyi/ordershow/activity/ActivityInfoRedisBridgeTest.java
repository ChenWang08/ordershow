package com.fengyi.ordershow.activity;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
class ActivityInfoRedisBridgeTest {
  @Test void usesTheConfiguredEnvironmentChannel() {
    var redis=mock(StringRedisTemplate.class);
    var snapshots=mock(ActivityInfoSnapshotService.class);
    var streams=mock(ActivityInfoStreamService.class);
    var bridge=new ActivityInfoRedisBridge(redis,mock(RedisConnectionFactory.class),new ObjectMapper(),snapshots,streams,"order-show:test:activity");
    when(redis.convertAndSend(eq("order-show:test:activity"),anyString())).thenReturn(1L);
    bridge.forward(1);
    verify(snapshots).load(1);
    verify(redis).convertAndSend(eq("order-show:test:activity"),anyString());
  }
}
