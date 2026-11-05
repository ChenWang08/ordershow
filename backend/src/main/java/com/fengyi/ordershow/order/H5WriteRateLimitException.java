package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.DomainException;
import org.springframework.http.HttpStatus;

public final class H5WriteRateLimitException extends DomainException {
  private final long retryAfterSeconds;

  H5WriteRateLimitException(long retryAfterMs) {
    super(HttpStatus.TOO_MANY_REQUESTS, "H5_WRITE_RATE_LIMITED", "操作太频繁，请稍后再试");
    retryAfterSeconds = Math.max(1, (retryAfterMs + 999) / 1000);
  }

  public long retryAfterSeconds() { return retryAfterSeconds; }
}
