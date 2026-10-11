package com.fengyi.ordershow.config;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Fail at bean construction, before application runners can mutate data. */
@Component
@Profile("cloud")
public class CloudConfigurationGuard {
  public CloudConfigurationGuard(Environment env) {
    for (String name : new String[]{"DB_URL", "DB_USERNAME", "DB_PASSWORD", "REDIS_HOST", "REDIS_PASSWORD",
        "PUBLIC_ORIGIN", "PHONE_HMAC_KEY", "PHONE_ENCRYPTION_KEY", "STORAGE_ENDPOINT",
        "STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "OSS_REGION", "REALTIME_CHANNEL"}) {
      String value = env.getProperty(name, "");
      if (value.isBlank() || value.contains("REPLACE_ME") || value.startsWith("local-") || value.startsWith("order_show_local")) {
        throw new IllegalStateException("Missing or placeholder cloud configuration: " + name);
      }
    }
    for (String name : new String[]{"PHONE_HMAC_KEY", "PHONE_ENCRYPTION_KEY"}) {
      if (env.getProperty(name, "").length() < 32) throw new IllegalStateException(name + " must contain at least 32 characters");
    }
    if (!"oss".equals(env.getProperty("STORAGE_PROVIDER"))) throw new IllegalStateException("Cloud STORAGE_PROVIDER must be oss");
    if (!env.getProperty("PUBLIC_ORIGIN", "").startsWith("https://")) throw new IllegalStateException("Cloud PUBLIC_ORIGIN requires HTTPS");
    if (!env.getProperty("STORAGE_ENDPOINT", "").startsWith("https://")) throw new IllegalStateException("Cloud STORAGE_ENDPOINT requires HTTPS");
    for (String key : new String[]{"spring.flyway.enabled", "order-show.bootstrap-enabled",
        "order-show.legacy-migration-enabled", "order-show.price-backfill-enabled"}) {
      if (env.getProperty(key, Boolean.class, false)) throw new IllegalStateException("Cloud forbids " + key);
    }
    if (!env.getProperty("order-show.cookie-secure", Boolean.class, false)) throw new IllegalStateException("Cloud requires secure cookies");
  }
}
