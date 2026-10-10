package com.fengyi.ordershow.imports;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import com.fengyi.ordershow.common.ProductBusinessKey;
import com.fengyi.ordershow.common.TextNormalizer;


final class ImportWorkbookRules {
  private ImportWorkbookRules() {}
  static String whitelistCustomerType(String value) {
    String normalized = text(value).replaceAll("\\s+", "");
    if (normalized.isBlank()) return "ALL";
    if (normalized.contains("特渠")) return "SPECIAL";
    if (normalized.contains("综合")) return "GENERAL";
    return "ALL";
  }

  static boolean optionalProductMissing(Map<String, Object> data) {
    return com.fengyi.ordershow.common.ProductCompleteness.incomplete(data.get("casePrice"), data.get("tonCaseFactor"));
  }

  static String priceTierError(Map<String, Object> data) {
    String quantityText = text(data.get("priceTierMinQuantity"));
    String priceText = text(data.get("priceTierCasePrice"));
    String pricingMode = text(data.get("priceTierPricingMode"));
    if (quantityText.isBlank() && priceText.isBlank()) return null;
    if (quantityText.isBlank() || priceText.isBlank()) return "请同时填写阶梯起订箱数和阶梯箱价";
    if (!pricingMode.isBlank() && !Set.of("WHOLE_ORDER", "INCREMENTAL").contains(pricingMode)) return "阶梯计价模式不正确";
    try {
      BigDecimal quantity = new BigDecimal(quantityText);
      BigDecimal tierPrice = new BigDecimal(priceText);
      BigDecimal basePrice = new BigDecimal(text(data.get("casePrice")));
      if (quantity.stripTrailingZeros().scale() > 0 || quantity.compareTo(BigDecimal.valueOf(2)) < 0
          || quantity.compareTo(BigDecimal.valueOf(999_999)) > 0) {
        return "阶梯起订箱数必须为 2 至 999999 的整数";
      }
      if (tierPrice.signum() <= 0 || basePrice.signum() <= 0 || tierPrice.compareTo(basePrice) >= 0) {
        return "阶梯箱价必须大于 0 且低于基础箱价";
      }
      return null;
    } catch (NumberFormatException exception) {
      return "阶梯起订箱数和阶梯箱价格式不正确";
    }
  }

  static String productKey(Map<String, Object> data) {
    return ProductBusinessKey.businessKey(text(data.get("customerType")), text(data.get("rebateStatus")),
        text(data.get("materialName")), text(data.get("materialCode")));
  }

  static String productCustomerType(String value) {
    return switch (text(value)) {
      case "综合" -> "GENERAL";
      case "特渠" -> "SPECIAL";
      case "" -> "ALL";
      default -> "ALL";
    };
  }

  static String productRebateStatus(String value) {
    return switch (text(value)) {
      case "是" -> "PARTICIPATING";
      case "否" -> "NOT_PARTICIPATING";
      case "" -> "ALL";
      default -> "ALL";
    };
  }

  static String productNameMatchKey(Map<String, Object> data) {
    return ProductBusinessKey.nameGroupKey(text(data.get("customerType")), text(data.get("rebateStatus")),
        text(data.get("materialName")));
  }

  static Set<Integer> duplicateProductRowIndexes(List<Map<String, Object>> rows) {
    Map<String, List<Integer>> nameGroups = new HashMap<>();
    for (int index = 0; index < rows.size(); index++) {
      Map<String, Object> row = rows.get(index);
      if (bool(row.get("customerTypeInvalid")) || bool(row.get("rebateStatusInvalid"))
          || ProductBusinessKey.normalizedMaterialName(text(row.get("materialName"))).isBlank()) continue;
      nameGroups.computeIfAbsent(productNameMatchKey(row), ignored -> new ArrayList<>()).add(index);
    }
    Set<Integer> duplicateIndexes = new HashSet<>();
    for (List<Integer> group : nameGroups.values()) {
      if (group.size() < 2) continue;
      Map<String, List<Integer>> codeGroups = new HashMap<>();
      for (int index : group) {
        String code = ProductBusinessKey.normalizeMaterialCode(text(rows.get(index).get("materialCode")));
        codeGroups.computeIfAbsent(code, ignored -> new ArrayList<>()).add(index);
      }
      if (codeGroups.containsKey("")) {
        duplicateIndexes.addAll(group);
      } else {
        codeGroups.values().stream().filter(matches -> matches.size() > 1).forEach(duplicateIndexes::addAll);
      }
    }
    return duplicateIndexes;
  }

  static String decimalText(String value) {
    try { return value == null || value.isBlank() ? "" : new BigDecimal(value.replace(",", "")).stripTrailingZeros().toPlainString(); }
    catch (Exception ignored) { return ""; }
  }

  static String positiveDecimalText(String value) {
    String parsed = decimalText(value);
    try { return !parsed.isBlank() && new BigDecimal(parsed).signum() > 0 ? parsed : ""; }
    catch (Exception ignored) { return ""; }
  }

  static BigDecimal decimal(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")); }
    catch (Exception ignored) { return null; }
  }

  static int intValue(Object value, int fallback) {
    try { return Integer.parseInt(text(value)); } catch (Exception ignored) { return fallback; }
  }

  static int intText(String value, int fallback) { return intValue(value, fallback); }

  static boolean bool(Object value) { return value instanceof Boolean b ? b : Boolean.parseBoolean(text(value)); }

  static String nullableText(Object value) { String text = text(value); return text.isBlank() ? null : text; }

  static String text(Object value) { return value == null ? "" : value.toString().trim(); }

  static String normalize(String value) { return TextNormalizer.normalize(value); }

  static String truncate(String value, int max) { String safe = Objects.requireNonNullElse(value, ""); return safe.length() <= max ? safe : safe.substring(0, max); }
}
