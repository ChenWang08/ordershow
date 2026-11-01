package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.H5CatalogDataService.Change;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

class ProductCatalogRedisBridgeTest {
  final StringRedisTemplate redis=mock(StringRedisTemplate.class);
  final H5CatalogCache cache=mock(H5CatalogCache.class);
  final ProductCatalogRedisBridge bridge=new ProductCatalogRedisBridge(redis,mock(RedisConnectionFactory.class),new ObjectMapper(),cache);
  final Change change=new Change(1,2,2,Set.of(3L),false);

  @Test void failedPublicationBacksOffAndSubscriptionRecoveryAllowsImmediateRetry() {
    when(redis.convertAndSend(anyString(),anyString())).thenThrow(new IllegalStateException("offline")).thenReturn(1L);
    assertThatThrownBy(()->bridge.forward(change)).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(()->bridge.forward(change)).isInstanceOf(IllegalStateException.class);
    verify(redis).convertAndSend(anyString(),anyString()); // The 500ms scanner does not repeatedly hit Redis.
    bridge.onChannelSubscribed(new byte[0],1); bridge.forward(change);
    verify(redis,times(2)).convertAndSend(anyString(),anyString()); verify(cache).resynchronize();
  }

  @Test void messagesOnlyInvalidateTheSpecifiedCatalogAndInvalidMessagesAreRejected() throws Exception {
    var json=new ObjectMapper();
    bridge.onMessage(message(json.writeValueAsBytes(change)),null);
    verify(cache).changed(change);
    bridge.onMessage(message("{}".getBytes(StandardCharsets.UTF_8)),null);
    bridge.onMessage(message(json.writeValueAsBytes(new Change(-1,2,2,Set.of(),true))),null);
    verifyNoMoreInteractions(cache);
  }

  @Test void usesTheConfiguredEnvironmentChannel() {
    var isolated=new ProductCatalogRedisBridge(redis,mock(RedisConnectionFactory.class),new ObjectMapper(),cache,"order-show:test:catalog");
    when(redis.convertAndSend(eq("order-show:test:catalog"),anyString())).thenReturn(1L);
    isolated.forward(change);
    verify(redis).convertAndSend(eq("order-show:test:catalog"),anyString());
  }

  private Message message(byte[] body) { var message=mock(Message.class); when(message.getBody()).thenReturn(body); return message; }
}
