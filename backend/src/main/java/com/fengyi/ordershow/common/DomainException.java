package com.fengyi.ordershow.common;

import org.springframework.http.HttpStatus;

public class DomainException extends RuntimeException {
  private final HttpStatus status;
  private final String code;

  public DomainException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() { return status; }
  public String code() { return code; }

  public static DomainException badRequest(String code, String message) {
    return new DomainException(HttpStatus.BAD_REQUEST, code, message);
  }

  public static DomainException unauthorized(String message) {
    return new DomainException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
  }

  public static DomainException forbidden(String code, String message) {
    return new DomainException(HttpStatus.FORBIDDEN, code, message);
  }

  public static DomainException notFound(String code, String message) {
    return new DomainException(HttpStatus.NOT_FOUND, code, message);
  }

  public static DomainException conflict(String code, String message) {
    return new DomainException(HttpStatus.CONFLICT, code, message);
  }

  public static DomainException unprocessable(String code, String message) {
    return new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
  }
}
