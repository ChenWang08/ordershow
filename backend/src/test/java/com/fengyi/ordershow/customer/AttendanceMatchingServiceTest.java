package com.fengyi.ordershow.customer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import org.junit.jupiter.api.Test;

class AttendanceMatchingServiceTest {
  @Test
  void prefersUniqueFullNameMatch() {
    var result = AttendanceMatchingService.decideNameMatches(List.of(101L), List.of());

    assertEquals("MATCHED", result.status());
    assertEquals(101L, result.customerId());
    assertEquals("FULL_NAME", result.method());
  }

  @Test
  void fallsBackToUniqueBranchAndShortNameMatch() {
    var result = AttendanceMatchingService.decideNameMatches(List.of(), List.of(202L));

    assertEquals("MATCHED", result.status());
    assertEquals(202L, result.customerId());
    assertEquals("SHORT_NAME", result.method());
  }

  @Test
  void requiresConfirmationWhenFullAndShortNamesPointToDifferentCustomers() {
    var result = AttendanceMatchingService.decideNameMatches(List.of(101L), List.of(202L));

    assertEquals("PENDING_CONFIRMATION", result.status());
    assertEquals("FULL_SHORT_NAME_CONFLICT", result.reasonCode());
    assertNull(result.customerId());
  }

  @Test
  void requiresConfirmationForNonUniqueNames() {
    var result = AttendanceMatchingService.decideNameMatches(List.of(101L, 102L), List.of());

    assertEquals("PENDING_CONFIRMATION", result.status());
    assertEquals("MULTIPLE_CANDIDATES", result.reasonCode());
    assertNull(result.customerId());
  }

  @Test
  void remainsUnmatchedWhenNoNameMatches() {
    var result = AttendanceMatchingService.decideNameMatches(List.of(), List.of());

    assertEquals("UNMATCHED", result.status());
    assertEquals("NO_UNIQUE_MATCH", result.reasonCode());
    assertNull(result.customerId());
  }
}
