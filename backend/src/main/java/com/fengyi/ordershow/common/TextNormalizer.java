package com.fengyi.ordershow.common;

import java.util.Locale;

/** Shared normalization for business names used by imports and customer matching. */
public final class TextNormalizer {
  private TextNormalizer() {}

  public static String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.CHINA)
        .replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", "");
  }
}
