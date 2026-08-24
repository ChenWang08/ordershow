package com.fengyi.ordershow.common;

import java.util.List;

public record PageResponse<T>(List<T> data, PageMeta page, String traceId) {
  public record PageMeta(int number, int size, long totalElements, int totalPages) {}

  public static <T> PageResponse<T> of(List<T> data, int number, int size, long total, String traceId) {
    return new PageResponse<>(data, new PageMeta(number, size, total, (int) Math.ceil(total / (double) size)), traceId);
  }
}
