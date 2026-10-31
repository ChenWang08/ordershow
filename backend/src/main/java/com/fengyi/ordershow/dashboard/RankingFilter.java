package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.common.DomainException;
import java.util.List;

/** Empty selections use explicit flags, so real names cannot collide with a magic string. */
public record RankingFilter(String customerType, String regionCode, boolean regionUnassigned,
                            String productLine, boolean productLineUnassigned,
                            List<String> varieties, boolean includeUnspecifiedVariety,
                            DashboardService.RankingMetric metric) {
  public RankingFilter {
    customerType = DashboardService.normalizeRankingCustomerType(customerType);
    if (customerType != null && !List.of("GENERAL", "SPECIAL").contains(customerType)) invalid("客户类型不正确");
    regionCode = clean(regionCode, 64);
    productLine = clean(productLine, 200);
    if (regionUnassigned && regionCode != null) invalid("大区与未填写大区不能同时选择");
    if (productLineUnassigned && productLine != null) invalid("项目组与未填写项目组不能同时选择");
    if (varieties != null && varieties.size() > 500) invalid("一次最多选择 500 个品种");
    varieties = varieties == null ? List.of() : varieties.stream().map(v -> clean(v, 100)).peek(v -> {
      if (v == null) invalid("未填写品种请使用专用选项");
    }).distinct().sorted().toList();
    if (metric == null) metric = DashboardService.RankingMetric.AMOUNT;
  }

  public boolean filtersProducts() {
    return productLine != null || productLineUnassigned || !varieties.isEmpty() || includeUnspecifiedVariety;
  }

  private static String clean(String value, int max) {
    if (value == null || value.isBlank()) return null;
    value = value.trim();
    if (value.length() > max) invalid("筛选值过长");
    return value;
  }

  private static void invalid(String message) { throw DomainException.badRequest("RANKING_FILTER_INVALID", message); }
}
