package com.fengyi.ordershow.common;

public record ApiResponse<T>(T data, String traceId) {
  public static <T> ApiResponse<T> of(T data, String traceId) {
    return new ApiResponse<>(data, traceId);
  }
}
