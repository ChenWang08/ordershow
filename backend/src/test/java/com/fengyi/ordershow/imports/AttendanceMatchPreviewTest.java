package com.fengyi.ordershow.imports;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.customer.AttendanceMatchingService;
import com.fengyi.ordershow.customer.AttendanceMatchingService.MatchResult;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AttendanceMatchPreviewTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final AttendanceMatchingService matching = mock(AttendanceMatchingService.class);
  private final ImportTaskRepository tasks = mock(ImportTaskRepository.class);
  private final ImportService service = new ImportService(jdbc, null, null, new ObjectMapper(), null, null, matching, null, tasks);

  private void prepare(Long whitelistVersion, MatchResult... results) {
    var task = mock(ImportService.ImportTask.class);
    when(task.importType()).thenReturn("ATTENDANCE");
    when(task.activityId()).thenReturn(1L);
    when(tasks.task(8L)).thenReturn(task);
    when(matching.currentWhitelistVersion(1L)).thenReturn(whitelistVersion);
    var rows = java.util.stream.IntStream.range(0, results.length)
        .mapToObj(i -> new ImportData.MaterializeRow(i + 1L,
            Map.<String, Object>of("dealerFullName", "dealer-" + i, "branchName", "branch", "participantType", "综合"),
            null, null, null)).toList();
    when(jdbc.query(contains("FROM import_staging_row"), org.mockito.ArgumentMatchers.<RowMapper<ImportData.MaterializeRow>>any(), eq(8L)))
        .thenReturn(rows);
    for (int i = 0; i < results.length; i++) {
      when(matching.match(1L, whitelistVersion, "综合", "branch", "dealer-" + i)).thenReturn(results[i]);
    }
  }

  @ParameterizedTest
  @CsvSource({"UNMATCHED,NO_UNIQUE_MATCH", "PENDING_CONFIRMATION,MULTIPLE_CANDIDATES", "PENDING_CONFIRMATION,FULL_SHORT_NAME_CONFLICT"})
  void previewsRowsWithoutAnyMatchedCustomer(String status, String reason) {
    prepare(17L, new MatchResult(null, status, null, reason), new MatchResult(null, status, null, reason));
    var preview = service.attendanceMatchPreview(8L);
    assertEquals(2, preview.totalCount());
    assertEquals(0, preview.matchedCount());
    assertEquals(0, preview.eligibleCustomerCount());
    assertEquals(status.equals("UNMATCHED") ? 2 : 0, preview.unmatchedCount());
    assertEquals(status.equals("PENDING_CONFIRMATION") ? 2 : 0, preview.pendingCount());
    for (var row : preview.rows()) {
      assertNull(row.activityCustomerId());
      assertNull(row.matchedDealerName());
      assertEquals(reason, row.matchReasonCode());
      assertFalse(row.lotteryEligible());
    }
    verify(jdbc, never()).query(contains("FROM activity_customer"), any(RowMapper.class), any(Object[].class));
  }

  @Test
  void previewsBeforeWhitelistPublication() {
    prepare(null, new MatchResult(null, "UNMATCHED", null, "WHITELIST_NOT_PUBLISHED"));
    var preview = service.attendanceMatchPreview(8L);
    assertNull(preview.whitelistVersionId());
    assertEquals(1, preview.unmatchedCount());
    assertEquals("WHITELIST_NOT_PUBLISHED", preview.rows().getFirst().matchReasonCode());
    assertFalse(preview.rows().getFirst().lotteryEligible());
  }

  @Test
  void mixedPreviewPreservesNamesAndCountsUniqueEligibleCustomers() {
    prepare(17L, new MatchResult(10L, "MATCHED", "FULL_NAME_BRANCH", null),
        new MatchResult(10L, "MATCHED", "FULL_NAME_BRANCH", null),
        new MatchResult(null, "UNMATCHED", null, "NO_UNIQUE_MATCH"),
        new MatchResult(null, "PENDING_CONFIRMATION", null, "MULTIPLE_CANDIDATES"));
    when(jdbc.query(contains("FROM activity_customer"), org.mockito.ArgumentMatchers.<RowMapper<Map.Entry<Long, String>>>any(), any(Object[].class)))
        .thenReturn(List.of(Map.entry(10L, "Dealer")));
    var preview = service.attendanceMatchPreview(8L);
    assertEquals(4, preview.totalCount());
    assertEquals(2, preview.matchedCount());
    assertEquals(1, preview.eligibleCustomerCount());
    assertEquals(1, preview.pendingCount());
    assertEquals(1, preview.unmatchedCount());
    assertEquals("Dealer", preview.rows().getFirst().matchedDealerName());
    assertTrue(preview.rows().getFirst().lotteryEligible());
    assertNull(preview.rows().get(2).matchedDealerName());
    assertFalse(preview.rows().get(3).lotteryEligible());
  }

  @Test
  void previewsAllMatchedRows() {
    prepare(17L, new MatchResult(10L, "MATCHED", "FULL_NAME_BRANCH", null));
    when(jdbc.query(contains("FROM activity_customer"), org.mockito.ArgumentMatchers.<RowMapper<Map.Entry<Long, String>>>any(), any(Object[].class)))
        .thenReturn(List.of(Map.entry(10L, "Dealer")));
    var preview = service.attendanceMatchPreview(8L);
    assertEquals(1, preview.matchedCount());
    assertEquals(1, preview.eligibleCustomerCount());
    assertEquals("Dealer", preview.rows().getFirst().matchedDealerName());
  }
}
