package com.fengyi.ordershow.config;

import com.fengyi.ordershow.dashboard.RealtimeEventService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class RealtimeConfiguration {
  @Bean
  RedisMessageListenerContainer realtimeListener(RedisConnectionFactory factory, RealtimeEventService events,
      @Value("${REALTIME_CHANNEL:order-show:local:events}") String channel) {
    var container = new RedisMessageListenerContainer();
    container.setConnectionFactory(factory);
    container.addMessageListener((message, pattern) -> events.receive(message.getBody()), new ChannelTopic(channel));
    return container;
  }
}
