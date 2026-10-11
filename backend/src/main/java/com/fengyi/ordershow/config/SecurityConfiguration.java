package com.fengyi.ordershow.config;

import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
  private final com.fengyi.ordershow.security.MemberPermissionService memberPermissions;
  private final AuthService authService;
  private final OrderShowProperties properties;
  private final AuditService auditService;
  private final DepartmentAccessService departmentAccess;

  public SecurityConfiguration(AuthService authService, OrderShowProperties properties, AuditService auditService,
      DepartmentAccessService departmentAccess, com.fengyi.ordershow.security.MemberPermissionService memberPermissions) {
    this.memberPermissions = memberPermissions;
    this.authService = authService;
    this.properties = properties;
    this.auditService = auditService;
    this.departmentAccess = departmentAccess;
  }

  @Bean
  public static PasswordEncoder passwordEncoder() {
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
    config.setAllowedOrigins(Arrays.stream(properties.publicOrigin().split(","))
        .map(String::trim)
        .filter(origin -> !origin.isEmpty())
        .toList());
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Content-Type", "X-CSRF-Token", "Idempotency-Key", "If-Match", "X-Request-Id", "X-H5-Customer-Id"));
    config.setExposedHeaders(List.of("X-Request-Id", "ETag", "Content-Disposition", "Retry-After"));
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
        if (admin.isSuperAdmin() && admin.mustChangePassword() && !request.getRequestURI().endsWith("/admin/auth/change-password")
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
        var admin = authService.requireAdmin(request);
        Matcher matcher = ACTIVITY_ID.matcher(request.getRequestURI());
        if (matcher.find()) departmentAccess.requireActivityAccess(admin, Long.parseLong(matcher.group(1)));
        return true;
      }
    }).addPathPatterns("/admin/activities/**");

    registry.addInterceptor(new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        memberPermissions.requireAccess(authService.requireAdmin(request), request);
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
    }).addPathPatterns("/admin/**", "/h5/**");
  }

  private static boolean isWrite(HttpServletRequest request) {
    return !(HttpMethod.GET.matches(request.getMethod()) || HttpMethod.HEAD.matches(request.getMethod())
        || HttpMethod.OPTIONS.matches(request.getMethod()));
  }

  private static final Pattern ACTIVITY_ID = Pattern.compile("/activities/(\\d+)(?:/|$)");
}
