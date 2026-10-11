package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class CloudConfigurationGuardTest {
  private MockEnvironment valid() {
    var env = new MockEnvironment();
    for (String key : new String[]{"DB_URL", "DB_USERNAME", "DB_PASSWORD", "REDIS_HOST", "REDIS_PASSWORD",
        "STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "OSS_REGION", "REALTIME_CHANNEL"}) env.setProperty(key, "test-value");
    env.setProperty("PHONE_HMAC_KEY", "h".repeat(40));
    env.setProperty("PHONE_ENCRYPTION_KEY", "e".repeat(40));
    env.setProperty("PUBLIC_ORIGIN", "https://orders.example.com");
    env.setProperty("STORAGE_ENDPOINT", "https://oss.example.com");
    env.setProperty("STORAGE_PROVIDER", "oss");
    env.setProperty("order-show.cookie-secure", "true");
    return env;
  }
  @Test void acceptsExplicitCloudSettings() { assertThatCode(() -> new CloudConfigurationGuard(valid())).doesNotThrowAnyException(); }
  @Test void forbidsAutomaticMigrationsAndDemoBootstrap() {
    for (String key : new String[]{"spring.flyway.enabled", "order-show.bootstrap-enabled", "order-show.legacy-migration-enabled", "order-show.price-backfill-enabled"}) {
      assertThatThrownBy(() -> new CloudConfigurationGuard(valid().withProperty(key, "true"))).hasMessageContaining(key);
    }
  }
  @Test void rejectsPlaceholdersWithoutPrintingSecret() {
    assertThatThrownBy(() -> new CloudConfigurationGuard(valid().withProperty("DB_PASSWORD", "REPLACE_ME_SECRET")))
        .hasMessageContaining("DB_PASSWORD").hasMessageNotContaining("REPLACE_ME_SECRET");
  }
}
