package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fengyi.ordershow.config.OrderShowProperties;
import org.junit.jupiter.api.Test;

class CryptoServiceTest {
  private final CryptoService crypto = new CryptoService(new OrderShowProperties(
      "http://localhost:3000", false, 8, 12, "unit-test-hmac", "unit-test-encryption",
      "admin", "password", "测试管理员", new OrderShowProperties.Storage("http://localhost:9000", "key", "secret", "bucket")));

  @Test
  void encryptsAndDecryptsPhoneWithoutUsingPlaintextAsLookupKey() {
    String phone = "13800138000";
    byte[] encrypted = crypto.encrypt(phone);

    assertThat(new String(encrypted)).doesNotContain(phone);
    assertThat(crypto.decrypt(encrypted)).isEqualTo(phone);
    assertThat(crypto.lookupHash(phone)).isEqualTo(crypto.lookupHash(phone));
  }

  @Test
  void normalizesAndMasksPhone() {
    assertThat(CryptoService.normalizePhone("138-0013-8000")).isEqualTo("13800138000");
    assertThat(CryptoService.maskPhone("13800138000")).isEqualTo("138****8000");
    assertThat(CryptoService.maskPhone("123")).isEqualTo("***");
  }
}
