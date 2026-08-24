package com.fengyi.ordershow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "order-show")
public record OrderShowProperties(
    String publicOrigin,
    boolean cookieSecure,
    int adminSessionHours,
    int h5SessionHours,
    String phoneHmacKey,
    String phoneEncryptionKey,
    String bootstrapAdminUsername,
    String bootstrapAdminPassword,
    String bootstrapAdminDisplayName,
    Storage storage
) {
  public record Storage(String endpoint, String accessKey, String secretKey, String bucket) {}
}
