package com.fengyi.ordershow.lottery;

import com.fengyi.ordershow.common.DomainException;
import java.util.List;

/** Exact names are stored as JSON arrays; commas and reserved-looking names remain literal. */
public record LotteryProductFilter(String productLine, boolean productLineUnassigned,
                                   List<String> varieties, boolean includeUnspecifiedVariety) {
  public LotteryProductFilter {
    if (productLine != null) {
      productLine = productLine.trim();
      if (productLine.isEmpty()) productLine = null;
    }
    varieties = varieties == null ? List.of() : varieties;
    if (varieties.size() > 500 || varieties.stream().anyMatch(v -> v == null || v.isBlank() || v.length() > 100)
        || productLine != null && productLine.length() > 200 || productLine != null && productLineUnassigned) {
      throw DomainException.badRequest("LOTTERY_PRODUCT_FILTER_INVALID", "项目组或品种条件不正确，品种最多选择500项");
    }
    varieties = varieties.stream().map(String::trim).distinct().sorted().toList();
    if (productLine == null && !productLineUnassigned && (!varieties.isEmpty() || includeUnspecifiedVariety)) {
      throw DomainException.badRequest("LOTTERY_PRODUCT_FILTER_INVALID", "请先选择项目组，再选择对应品种");
    }
  }
  public boolean filtered() { return productLine != null || productLineUnassigned || !varieties.isEmpty() || includeUnspecifiedVariety; }
}
