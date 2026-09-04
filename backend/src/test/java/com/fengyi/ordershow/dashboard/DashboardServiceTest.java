package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DashboardServiceTest {
  @Test
  void treatsAllAsAnUnfilteredCustomerTypeForRanking() {
    assertThat(DashboardService.normalizeRankingCustomerType("ALL")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType(" all ")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType(" ")).isNull();
    assertThat(DashboardService.normalizeRankingCustomerType("GENERAL")).isEqualTo("GENERAL");
    assertThat(DashboardService.normalizeRankingCustomerType(" special ")).isEqualTo("SPECIAL");
  }
}
