package com.fengyi.ordershow.dashboard;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class DashboardSummaryRefreshTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

  @Test
  void disabledSummaryWritesNothing() {
    new DashboardSummaryStore(jdbc, false, "").refresh(7);
    verifyNoInteractions(jdbc);
  }

  @Test
  void enabledSummaryMarksACleanRowDirtyAndDoesNotRebuildItBeforeTheMarkIsVisible() {
    when(jdbc.queryForObject(contains("SELECT dirty"), eq(Boolean.class), eq(7L))).thenReturn(false);
    new DashboardSummaryStore(jdbc, true, "").refresh(7);
    verify(jdbc).update(contains("ON DUPLICATE KEY UPDATE dirty"), eq(7L));
    verify(jdbc, never()).update(contains("DELETE FROM order_dashboard_product_line_stat"), anyLong());
  }

  @Test
  void enabledSummaryRebuildsOnceWhenTheMarkedRowIsDirty() {
    when(jdbc.queryForObject(contains("SELECT dirty"), eq(Boolean.class), eq(7L))).thenReturn(true);
    new DashboardSummaryStore(jdbc, true, "").refresh(7);
    verify(jdbc).update(contains("ON DUPLICATE KEY UPDATE dirty"), eq(7L));
    verify(jdbc).update(contains("DELETE FROM order_dashboard_product_line_stat"), eq(7L));
    verify(jdbc).update(contains("INSERT INTO order_dashboard_product_line_stat"), eq(7L));
    verify(jdbc).update(contains("s.dirty=FALSE"), eq(7L), eq(7L));
  }
}
