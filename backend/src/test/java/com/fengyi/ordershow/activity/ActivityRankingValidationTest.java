package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class ActivityRankingValidationTest {
  @Test
  void rejectsOutOfRangeLimitsBeforeWritingToTheDatabase() {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      var validator = factory.getValidator();
      for (int limit : new int[]{0, -1, 501}) {
        var request = request(limit, limit);
        assertThat(validator.validate(request)).extracting(value -> value.getPropertyPath().toString())
            .containsExactlyInAnyOrder("companyRankingTopN", "branchRankingTopN");
      }
      for (int limit : new int[]{1, 30, 90, 500}) {
        assertThat(validator.validate(request(limit, limit))).isEmpty();
      }
    }
  }

  private ActivityController.ActivityRequest request(int companies, int branches) {
    return new ActivityController.ActivityRequest(null, "排行测试", "", "Asia/Shanghai",
        Instant.parse("2099-01-01T00:00:00Z"), Instant.parse("2099-01-01T01:00:00Z"),
        Instant.parse("2099-01-01T02:00:00Z"), "ALL", companies, branches, 3, List.of(), 1L);
  }
}
