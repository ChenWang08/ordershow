package com.fengyi.ordershow.activity;

import java.lang.reflect.Method;
import java.util.Map;
import org.aopalliance.intercept.MethodInterceptor;
import org.springframework.aop.Advisor;
import org.springframework.aop.support.DefaultPointcutAdvisor;
import org.springframework.aop.support.StaticMethodMatcherPointcut;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.annotation.Role;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.core.Ordered;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.servlet.HandlerMapping;

/** Acquires the lifecycle lock before existing controller/service transactions and business locks. */
@Configuration
public class ActivityWriteConfiguration {
  @Bean
  @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
  Advisor activityWriteAdvisor(@Lazy ActivityAccessPolicy policy, @Lazy PlatformTransactionManager manager) {
    // Advisors are discovered while post-processors are being registered; defer database dependencies.
    var pointcut = new StaticMethodMatcherPointcut() {
      @Override public boolean matches(Method method, Class<?> type) {
        return type.isAnnotationPresent(RestController.class) &&
            (method.isAnnotationPresent(PostMapping.class) || method.isAnnotationPresent(PutMapping.class)
                || method.isAnnotationPresent(PatchMapping.class) || method.isAnnotationPresent(DeleteMapping.class));
      }
    };
    var tx = new TransactionTemplate(manager);
    tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    MethodInterceptor advice = invocation -> {
      if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes context)) return invocation.proceed();
      var request = context.getRequest();
      Object value = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
      if (!(value instanceof Map<?,?> vars)) return invocation.proceed();
      Long id = vars.get("activityId") == null ? null : Long.valueOf(vars.get("activityId").toString());
      if (id == null && vars.get("activityCode") != null) id = policy.readableCode(vars.get("activityCode").toString());
      if (id == null) return invocation.proceed();
      final long activityId = id;
      String path = request.getRequestURI().substring(request.getContextPath().length());
      // These flows own transaction boundaries for deadlock retry / committed import failure records.
      // Their services acquire the same activity lock inside the first owned transaction.
      if (("PUT".equals(request.getMethod()) && path.matches("/h5/activities/[^/]+/order-draft"))
          || ("POST".equals(request.getMethod()) && path.matches("/admin/activities/[0-9]+/imports")))
        return invocation.proceed();
      boolean lifecycle = path.matches("/admin/activities/[0-9]+/(archive|unarchive|permanent-deletion)");
      boolean adminPreview = path.matches("/admin/activities/[0-9]+/(orders|lottery/candidates)/preview");
      boolean allowArchiveRead = path.matches("/screen/activities/[^/]+/ranking")
          || adminPreview
          || path.matches("/admin/activities/[0-9]+/exports(?:/[0-9]+/cancel)?");
      // Previews don't change activity-wide state; reviews already serialize their customer's writes.
      // Keep the outer transaction/status checks, sharing its activity lock with H5 submissions.
      // Every other admin mutation (including draw/price/lifecycle changes) remains exclusive.
      boolean shared = !path.contains("/admin/") || ("POST".equals(request.getMethod())
          && (adminPreview || path.matches("/admin/activities/[0-9]+/order-change-requests/[0-9]+/(approve|reject)")));
      try {
        return tx.execute(status -> {
          policy.lockWrite(activityId, lifecycle, allowArchiveRead, path.endsWith("/permanent-deletion"), shared);
          try { return invocation.proceed(); }
          catch (RuntimeException | Error error) { throw error; }
          catch (Throwable error) { throw new InvocationFailure(error); }
        });
      } catch (InvocationFailure error) { throw error.getCause(); }
    };
    var advisor = new DefaultPointcutAdvisor(pointcut, advice);
    advisor.setOrder(Ordered.HIGHEST_PRECEDENCE + 100);
    return advisor;
  }
  private static final class InvocationFailure extends RuntimeException {
    InvocationFailure(Throwable cause) { super(cause); }
  }
}
