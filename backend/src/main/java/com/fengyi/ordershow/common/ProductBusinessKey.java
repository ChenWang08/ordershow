package com.fengyi.ordershow.common;

import java.util.Locale;
import java.util.Objects;

/** Shared product identity rules for import and manual catalog edits. */
public final class ProductBusinessKey {
  private ProductBusinessKey() {}

  public static String nameGroupKey(String customerType, String rebateStatus, String materialName) {
    return part(text(customerType)) + part(text(rebateStatus)) + part(normalizedMaterialName(materialName));
  }

  public static String businessKey(String customerType, String rebateStatus, String materialName, String materialCode) {
    return nameGroupKey(customerType, rebateStatus, materialName) + part(normalizeMaterialCode(materialCode));
  }

  public static boolean conflicts(String leftCustomerType, String leftRebateStatus, String leftMaterialName, String leftMaterialCode,
                                  String rightCustomerType, String rightRebateStatus, String rightMaterialName, String rightMaterialCode) {
    String leftName = TextNormalizer.normalize(leftMaterialName);
    String rightName = TextNormalizer.normalize(rightMaterialName);
    if (leftName.isBlank() || !leftName.equals(rightName)
        || !Objects.equals(text(leftCustomerType), text(rightCustomerType))
        || !Objects.equals(text(leftRebateStatus), text(rightRebateStatus))) return false;
    String leftCode = normalizeMaterialCode(leftMaterialCode);
    String rightCode = normalizeMaterialCode(rightMaterialCode);
    return leftCode.isBlank() || rightCode.isBlank() || leftCode.equals(rightCode);
  }

  public static String normalizeMaterialCode(String value) {
    return text(value).toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", "");
  }

  public static String normalizedMaterialName(String value) {
    return TextNormalizer.normalize(value);
  }

  private static String text(String value) {
    return value == null ? "" : value.trim();
  }

  private static String part(String value) {
    return value.length() + ":" + value;
  }
}
