package com.fengyi.ordershow.imports;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import com.fengyi.ordershow.common.ProductBusinessKey;
import com.fengyi.ordershow.common.TextNormalizer;


final class ImportValues {
  private ImportValues() {}
  static boolean optionalProductMissing(Map<String, Object> data) {
    return List.of("productLine", "specification", "casePack", "casePrice", "tonCaseFactor")
        .stream().anyMatch(key -> text(data.get(key)).isBlank());
  }

  static String productKey(Map<String, Object> data) {
    return ProductBusinessKey.businessKey(text(data.get("customerType")), text(data.get("rebateStatus")),
        text(data.get("materialName")), text(data.get("materialCode")));
  }

  static BigDecimal decimal(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")); }
    catch (Exception ignored) { return null; }
  }

  static Long integer(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")).longValueExact(); }
    catch (Exception ignored) { return null; }
  }

  static int intValue(Object value, int fallback) {
    try { return Integer.parseInt(text(value)); } catch (Exception ignored) { return fallback; }
  }

  static boolean bool(Object value) { return value instanceof Boolean b ? b : Boolean.parseBoolean(text(value)); }

  static String nullableText(Object value) { String text = text(value); return text.isBlank() ? null : text; }

  static String text(Object value) { return value == null ? "" : value.toString().trim(); }

  static String normalize(String value) { return TextNormalizer.normalize(value); }

  static String truncate(String value, int max) { String safe = Objects.requireNonNullElse(value, ""); return safe.length() <= max ? safe : safe.substring(0, max); }
}
