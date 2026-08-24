package com.fengyi.ordershow.security;

import com.fengyi.ordershow.config.OrderShowProperties;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class CryptoService {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final byte[] encryptionKey;
  private final byte[] hmacKey;

  public CryptoService(OrderShowProperties properties) {
    this.encryptionKey = Arrays.copyOf(sha256(properties.phoneEncryptionKey()), 32);
    this.hmacKey = sha256(properties.phoneHmacKey());
  }

  public byte[] lookupHash(String normalizedPhone) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(hmacKey, "HmacSHA256"));
      return mac.doFinal(normalizedPhone.getBytes(StandardCharsets.UTF_8));
    } catch (Exception exception) {
      throw new IllegalStateException("Cannot hash phone", exception);
    }
  }

  public byte[] encrypt(String value) {
    try {
      byte[] iv = new byte[12];
      RANDOM.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(encryptionKey, "AES"), new GCMParameterSpec(128, iv));
      byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      return ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array();
    } catch (Exception exception) {
      throw new IllegalStateException("Cannot encrypt value", exception);
    }
  }

  public String decrypt(byte[] value) {
    try {
      ByteBuffer buffer = ByteBuffer.wrap(value);
      byte[] iv = new byte[12];
      buffer.get(iv);
      byte[] encrypted = new byte[buffer.remaining()];
      buffer.get(encrypted);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(encryptionKey, "AES"), new GCMParameterSpec(128, iv));
      return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    } catch (Exception exception) {
      throw new IllegalStateException("Cannot decrypt value", exception);
    }
  }

  public byte[] sha256(String value) {
    return sha256(value.getBytes(StandardCharsets.UTF_8));
  }

  private static byte[] sha256(byte[] value) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(value);
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  public static String normalizePhone(String value) {
    return value == null ? "" : value.replaceAll("\\D", "");
  }

  public static String maskPhone(String value) {
    String phone = normalizePhone(value);
    return phone.length() == 11 ? phone.substring(0, 3) + "****" + phone.substring(7) : "***";
  }
}
