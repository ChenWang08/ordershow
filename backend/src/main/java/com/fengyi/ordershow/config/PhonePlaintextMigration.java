package com.fengyi.ordershow.config;

import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Migrates the legacy application-encrypted phone columns once, then clears them.
 * The business tables use normalized plaintext phone values after V023.
 */
@Component
@Order(0)
public class PhonePlaintextMigration implements ApplicationRunner {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;

  public PhonePlaintextMigration(JdbcTemplate jdbc, CryptoService crypto) {
    this.jdbc = jdbc;
    this.crypto = crypto;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    migrateCustomers();
    migrateAttendees();
  }

  private void migrateCustomers() {
    List<LegacyCustomer> rows = jdbc.query("""
        SELECT id, phone_ciphertext, confirmer_phone_ciphertext
        FROM activity_customer
        WHERE phone_ciphertext IS NOT NULL OR confirmer_phone_ciphertext IS NOT NULL
        """, (rs, rowNum) -> new LegacyCustomer(rs.getLong("id"), rs.getBytes("phone_ciphertext"),
        rs.getBytes("confirmer_phone_ciphertext")));
    for (LegacyCustomer row : rows) {
      String phone = decryptPhone(row.phoneCiphertext(), row.id());
      String confirmerPhone = row.confirmerPhoneCiphertext() == null
          ? null : decryptPhone(row.confirmerPhoneCiphertext(), row.id());
      jdbc.update("""
          UPDATE activity_customer
          SET phone = COALESCE(phone, ?), confirmer_phone = COALESCE(confirmer_phone, ?),
              phone_ciphertext = NULL, confirmer_phone_ciphertext = NULL
          WHERE id = ?
          """, phone, confirmerPhone, row.id());
    }
  }

  private void migrateAttendees() {
    List<LegacyAttendee> rows = jdbc.query("""
        SELECT id, phone_ciphertext
        FROM activity_attendee
        WHERE phone_ciphertext IS NOT NULL
        """, (rs, rowNum) -> new LegacyAttendee(rs.getLong("id"), rs.getBytes("phone_ciphertext")));
    for (LegacyAttendee row : rows) {
      jdbc.update("""
          UPDATE activity_attendee
          SET phone = COALESCE(phone, ?), phone_ciphertext = NULL
          WHERE id = ?
          """, decryptPhone(row.phoneCiphertext(), row.id()), row.id());
    }
  }

  private String decryptPhone(byte[] ciphertext, long rowId) {
    try {
      return CryptoService.normalizePhone(crypto.decrypt(ciphertext));
    } catch (RuntimeException exception) {
      throw new IllegalStateException("手机号明文迁移失败，记录 ID=" + rowId, exception);
    }
  }

  private record LegacyCustomer(long id, byte[] phoneCiphertext, byte[] confirmerPhoneCiphertext) {}
  private record LegacyAttendee(long id, byte[] phoneCiphertext) {}
}
