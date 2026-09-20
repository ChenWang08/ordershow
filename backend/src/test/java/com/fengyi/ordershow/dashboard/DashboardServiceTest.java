package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class DashboardServiceTest {
  @Test
  void usesTheDistrictLabelForTheUnassignedBucket() {
    var region = new DashboardService.GeneralRegion("UNASSIGNED", "未分片区", 10000, 2,
        new BigDecimal("120.50"), List.of());
    assertThat(region.regionName()).isEqualTo("未分大区");
    assertThat(region.regionCode()).isEqualTo("UNASSIGNED");
  }

  @Test
  void normalizesHistoricalLabelsWithoutChangingSnapshotMetricsOrCustomRegionNames() throws Exception {
    var snapshot = new ObjectMapper().readValue("""
        {"generalRegions":[
          {"regionCode":"UNASSIGNED","regionName":"未分片区","sortNo":10000,"orderCount":2,
           "amount":120.50,"productLines":[{"productLine":"酱油","amount":120.50,"quantity":3}]},
          {"regionCode":"EAST","regionName":"自定义片区","sortNo":1,"orderCount":1,
           "amount":80,"productLines":[]}
        ]}
        """, DashboardService.Report.class);
    var unassigned = snapshot.generalRegions().getFirst();
    assertThat(unassigned.regionName()).isEqualTo("未分大区");
    assertThat(unassigned.regionCode()).isEqualTo("UNASSIGNED");
    assertThat(unassigned.sortNo()).isEqualTo(10000);
    assertThat(unassigned.orderCount()).isEqualTo(2);
    assertThat(unassigned.amount()).isEqualByComparingTo("120.50");
    assertThat(unassigned.productLines()).containsExactly(
        new DashboardService.ProductLineTotal("酱油", new BigDecimal("120.50"), 3));
    assertThat(snapshot.generalRegions().get(1).regionName()).isEqualTo("自定义片区");
  }

  @Test
  void treatsAllAsAnUnfilteredCustomerTypeForRanking() {
    assertThat(DashboardService.normalizeRankingCustomerType("ALL")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType(" all ")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType(" ")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType("GENERAL")).isEqualTo("GENERAL");
    assertThat(DashboardService.normalizeRankingCustomerType(" special ")).isEqualTo("SPECIAL");
  }
}
