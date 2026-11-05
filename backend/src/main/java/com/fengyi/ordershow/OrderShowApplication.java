package com.fengyi.ordershow;

import com.fengyi.ordershow.config.OrderShowProperties;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@EnableScheduling
@EnableConfigurationProperties(OrderShowProperties.class)
@MapperScan("com.fengyi.ordershow.**.mapper")
public class OrderShowApplication {
  public static void main(String[] args) {
    if (java.util.Arrays.asList(args).contains("--export-worker")) {
      new org.springframework.boot.builder.SpringApplicationBuilder(com.fengyi.ordershow.exports.ExportWorkerApplication.class)
          .web(org.springframework.boot.WebApplicationType.NONE)
          .initializers(context -> context.getEnvironment().getPropertySources().addFirst(
              new org.springframework.core.env.MapPropertySource("exportWorkerMode", java.util.Map.of(
                  "order-show.export.worker", true, "spring.flyway.enabled", false))))
          .run(args);
      return;
    }
    SpringApplication.run(OrderShowApplication.class, args);
  }
}
