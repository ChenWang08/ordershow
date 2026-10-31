package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.common.DomainException;
import java.util.List;
import org.junit.jupiter.api.Test;

class RankingFilterTest {
  @Test void normalizesAllAndDeduplicatesWithoutSplittingLiteralComma() {
    var f = new RankingFilter(" all ", null, false, " 项目 ", false, List.of("品种,A", " 品种B ", "品种,A"), true, null);
    assertThat(f.customerType()).isNull();
    assertThat(f.productLine()).isEqualTo("项目");
    assertThat(f.varieties()).containsExactly("品种,A", "品种B");
    assertThat(f.filtersProducts()).isTrue();
  }
  @Test void allAndMissingAreDifferentAndInvalidCombinationsAreRejected() {
    assertThat(new RankingFilter(null, null, false, null, false, null, false, null).filtersProducts()).isFalse();
    assertThat(new RankingFilter(null, null, false, null, true, null, false, null).filtersProducts()).isTrue();
    assertThatThrownBy(() -> new RankingFilter("UNKNOWN", null, false, null, false, null, false, null)).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> new RankingFilter(null, "EAST", true, null, false, null, false, null)).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> new RankingFilter(null, null, false, "组", true, null, false, null)).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> new RankingFilter(null, null, false, null, false, List.of(" "), false, null)).isInstanceOf(DomainException.class);
  }
}
