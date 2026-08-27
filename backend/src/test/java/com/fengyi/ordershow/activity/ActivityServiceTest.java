package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class ActivityServiceTest {
  private static final Instant START = Instant.parse("2026-08-28T01:00:00Z");
  private static final Instant END = Instant.parse("2026-09-07T15:44:00Z");

  @Test
  void draftNeverStartsOnlyBecauseItsConfiguredTimeArrived() {
    assertThat(ActivityService.effectiveStatus("DRAFT", START, END, START.plusSeconds(1))).isEqualTo("DRAFT");
  }

  @Test
  void publishedActivityStartsAndClosesAtItsTimeBoundaries() {
    assertThat(ActivityService.effectiveStatus("SCHEDULED", START, END, START.minusMillis(1))).isEqualTo("SCHEDULED");
    assertThat(ActivityService.effectiveStatus("SCHEDULED", START, END, START)).isEqualTo("ACTIVE");
    assertThat(ActivityService.effectiveStatus("ACTIVE", START, END, END.minusMillis(1))).isEqualTo("ACTIVE");
    assertThat(ActivityService.effectiveStatus("ACTIVE", START, END, END)).isEqualTo("CLOSED");
  }
}
