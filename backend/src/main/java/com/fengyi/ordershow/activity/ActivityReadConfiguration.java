package com.fengyi.ordershow.activity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Runs before HTTP caches/ETags and catalog caches, including on every application replica. */
@Configuration
public class ActivityReadConfiguration implements WebMvcConfigurer {
  private final ActivityAccessPolicy policy;
  public ActivityReadConfiguration(ActivityAccessPolicy policy){this.policy=policy;}
  @Override public void addInterceptors(InterceptorRegistry registry){
    registry.addInterceptor(new HandlerInterceptor(){
      @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler){
        Object value=request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if(!(value instanceof Map<?,?> vars)) return true;
        if(vars.get("activityId")!=null && !request.getRequestURI().endsWith("/permanent-deletion"))
          policy.readable(Long.parseLong(vars.get("activityId").toString()));
        else if(vars.get("activityCode")!=null) policy.readableCode(vars.get("activityCode").toString());
        if(request.getRequestURI().contains("/public/files/") && vars.get("fileId")!=null)
          policy.readableFile(Long.parseLong(vars.get("fileId").toString()));
        return true;
      }
    }).addPathPatterns("/admin/activities/**","/public/**","/h5/**","/screen/**").order(-50);
  }
}
