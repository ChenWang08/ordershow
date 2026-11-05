package com.fengyi.ordershow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;

/** Runs after authentication/CSRF and before the order service's write transaction. */
@Component
public class H5CustomerWriteGuard {
  private final H5CustomerWriteRateLimiter limiter;
  private final OrderRepository orders;
  private final ObjectMapper json;

  public H5CustomerWriteGuard(H5CustomerWriteRateLimiter limiter, OrderRepository orders, ObjectMapper json) {
    this.limiter = limiter; this.orders = orders; this.json = json;
  }

  void submit(String code, H5Principal customer, OrderService.SubmitRequest body, String key, boolean includeHistory) {
    if (!limiter.enabled()) return;
    byte[] legacy = hash(body);
    byte[] fingerprint = body != null && body.items() != null && body.items().stream().allMatch(i -> i != null)
        ? H5SubmitFingerprint.digest(body, includeHistory) : legacy;
    check(code, customer, "ORDER_SUBMIT", key, fingerprint, legacy);
  }

  void changeRequest(String code, H5Principal customer, OrderService.ChangeRequestRequest body, String key) {
    if (!limiter.enabled()) return;
    byte[] fingerprint = hash(body);
    check(code, customer, "ORDER_CHANGE_REQUEST", key, fingerprint, fingerprint);
  }

  void withdraw(String code, H5Principal customer, OrderService.WithdrawRequest body, String key) {
    if (!limiter.enabled()) return;
    byte[] fingerprint = hash(body);
    check(code, customer, "ORDER_WITHDRAW", key, fingerprint, fingerprint);
  }

  private void check(String code, H5Principal customer, String endpoint, String key, byte[] fingerprint, byte[] legacy) {
    if (!limiter.enabled()) return;
    if (!code.equalsIgnoreCase(customer.activityCode()))
      throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动");
    if (key == null || key.isBlank() || key.length() > 128)
      throw DomainException.badRequest("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key");
    // This indexed receipt lookup is outside the write transaction. Old replays remain retries
    // even after the short Redis window expires; no order/history data is loaded here.
    boolean replay = orders.matchesH5Receipt(customer.activityId(), customer.customerId(), endpoint, key, fingerprint, legacy);
    limiter.check(customer.activityId(), customer.customerId(), endpoint, key, fingerprint, replay);
  }

  private byte[] hash(Object body) {
    try { return MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(body)); }
    catch (Exception error) { throw new IllegalStateException("Cannot fingerprint H5 write", error); }
  }
}
