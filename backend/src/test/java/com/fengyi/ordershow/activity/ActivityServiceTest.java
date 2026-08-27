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

  @Test
  void generatesStableUniqueBusinessActivityNumbersFromThePersistedId() {
    Instant createdAt = Instant.parse("2026-08-27T06:30:00Z");
    assertThat(ActivityService.generateActivityNo(12, createdAt, "Asia/Shanghai")).isEqualTo("HD20260827012");
    assertThat(ActivityService.generateActivityNo(13, createdAt, "Asia/Shanghai")).isEqualTo("HD20260827013");
  }

  @Test
  void detectsOnlyActualTimeOverlaps() {
    Instant firstStart = Instant.parse("2026-08-28T01:00:00Z");
    Instant firstEnd = Instant.parse("2026-08-28T03:00:00Z");
    assertThat(ActivityService.timesOverlap(firstStart, firstEnd,
        Instant.parse("2026-08-28T02:00:00Z"), Instant.parse("2026-08-28T04:00:00Z"))).isTrue();
    assertThat(ActivityService.timesOverlap(firstStart, firstEnd,
        firstEnd, Instant.parse("2026-08-28T04:00:00Z"))).isFalse();
  }
}
