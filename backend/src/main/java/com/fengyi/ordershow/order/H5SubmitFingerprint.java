package com.fengyi.ordershow.order;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;

/** V1 wire-independent fingerprint. Catalog ordering, not request ordering, determines order lines. */
final class H5SubmitFingerprint {
  private H5SubmitFingerprint() {}

  static byte[] digest(OrderService.SubmitRequest request, boolean includeHistory) {
    StringBuilder canonical = new StringBuilder("H5_ORDER_SUBMIT_V1\n")
        .append(request.expectedVersion()).append('\n').append(includeHistory).append('\n');
    request.items().stream().sorted(Comparator.comparingLong(OrderService.SubmitItem::productId))
        .forEach(item -> canonical.append(item.productId()).append(':').append(item.quantity()).append('\n'));
    try { return MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8)); }
    catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }
}
