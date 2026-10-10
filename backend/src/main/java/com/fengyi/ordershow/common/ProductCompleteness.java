package com.fengyi.ordershow.common;

import java.math.BigDecimal;

/** Shared by workbook parsing, preview validation, publication and manual maintenance. */
public final class ProductCompleteness {
  private ProductCompleteness() {}
  public static BigDecimal positive(Object value) {
    if (value == null) return null;
    try {
      BigDecimal number = new BigDecimal(value.toString().trim().replace(",", ""));
      return number.signum() > 0 ? number : null;
    } catch (NumberFormatException error) { return null; }
  }
  public static boolean incomplete(Object casePrice, Object tonCaseFactor) {
    return positive(casePrice) == null || positive(tonCaseFactor) == null;
  }
}
