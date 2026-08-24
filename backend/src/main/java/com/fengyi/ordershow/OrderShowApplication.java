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
    SpringApplication.run(OrderShowApplication.class, args);
  }
}
