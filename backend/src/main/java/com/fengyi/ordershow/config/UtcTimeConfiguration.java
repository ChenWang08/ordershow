package com.fengyi.ordershow.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fengyi.ordershow.common.UtcTime;
import java.io.IOException;
import java.time.LocalDateTime;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class UtcTimeConfiguration {
  @Bean
  Jackson2ObjectMapperBuilderCustomizer utcDatabaseTimes() {
    // JdbcTemplate maps DATETIME to LocalDateTime in map-based queries too.
    return builder -> builder.serializerByType(LocalDateTime.class, new JsonSerializer<LocalDateTime>() {
      @Override
      public void serialize(LocalDateTime value, JsonGenerator generator, SerializerProvider provider) throws IOException {
        generator.writeString(UtcTime.instant(value).toString());
      }
    });
  }
}
