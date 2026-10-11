package com.fengyi.ordershow.maintenance;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Offline CLI: generates only a BCrypt hash for the DBA; never starts Spring or connects to DB. */
public final class BootstrapPasswordHash {
  public static void main(String[] args) {
    var console = System.console();
    if (console == null) throw new IllegalStateException("Interactive terminal required; run docker with -it");
    char[] first = console.readPassword("Initial administrator password: ");
    char[] second = console.readPassword("Confirm password: ");
    if (first == null || second == null) throw new IllegalArgumentException("Cancelled");
    try {
      String value = new String(first);
      if (!Arrays.equals(first, second) || value.isBlank() || value.length() < 8 || value.length() > 100
          || value.getBytes(StandardCharsets.UTF_8).length > 72) throw new IllegalArgumentException("Password mismatch or invalid length (8-100 characters, <=72 UTF-8 bytes)");
      console.printf("BCrypt hash for DBA SQL (password is not printed):%n%s%n", new BCryptPasswordEncoder(12).encode(value));
    } finally { Arrays.fill(first, '\0'); Arrays.fill(second, '\0'); }
  }
}
