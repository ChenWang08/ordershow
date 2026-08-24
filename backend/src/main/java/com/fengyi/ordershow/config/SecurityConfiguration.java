package com.fengyi.ordershow.config;

import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class SecurityConfiguration implements WebMvcConfigurer {
  private final AuthService authService;
  private final OrderShowProperties properties;
  private final AuditService auditService;

  public SecurityConfiguration(AuthService authService, OrderShowProperties properties, AuditService auditService) {
    this.authService = authService;
    this.properties = properties;
    this.auditService = auditService;
  }

  @Bean
  static PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    return http.csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
        .formLogin(form -> form.disable())
        .httpBasic(basic -> basic.disable())
        .logout(logout -> logout.disable())
        .build();
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(List.of(properties.publicOrigin()));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Content-Type", "X-CSRF-Token", "Idempotency-Key", "If-Match", "X-Request-Id"));
    config.setExposedHeaders(List.of("X-Request-Id", "ETag", "Content-Disposition"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        var admin = authService.requireAdmin(request);
        if (admin.mustChangePassword() && !request.getRequestURI().endsWith("/admin/auth/change-password")
            && !request.getRequestURI().endsWith("/admin/auth/logout") && !HttpMethod.GET.matches(request.getMethod())) {
          throw com.fengyi.ordershow.common.DomainException.forbidden("PASSWORD_CHANGE_REQUIRED", "首次登录请先修改初始密码");
        }
        if (isWrite(request)) authService.requireCsrf(request, true);
        return true;
      }
    }).addPathPatterns("/admin/**").excludePathPatterns("/admin/auth/login");

    registry.addInterceptor(new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        authService.requireH5(request);
        if (isWrite(request)) authService.requireCsrf(request, false);
        return true;
      }
    }).addPathPatterns("/h5/**");

    registry.addInterceptor(new HandlerInterceptor() {
      @Override
      public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        auditService.record(request, response, ex);
      }
    }).addPathPatterns("/admin/**", "/h5/**").excludePathPatterns("/admin/auth/login");
  }

  private static boolean isWrite(HttpServletRequest request) {
    return !(HttpMethod.GET.matches(request.getMethod()) || HttpMethod.HEAD.matches(request.getMethod())
        || HttpMethod.OPTIONS.matches(request.getMethod()));
  }
}
