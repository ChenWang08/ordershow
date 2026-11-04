package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import java.sql.ResultSet;

class OrderQueryServiceTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final CryptoService crypto = mock(CryptoService.class);
  private final OrderQueryService service = new OrderQueryService(jdbc, crypto);

  @Test
  void clampsPaginationAndKeepsTheActivityAndPhoneFilters() {
    byte[] hash = {1, 2, 3};
    when(crypto.lookupHash("13800000000")).thenReturn(hash);
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(201L);

    var page = service.adminOrders(7, "WITHDRAWN", "GENERAL", " 13800000000 ", -1, 999, "trace-1");

    assertThat(page.page().number()).isEqualTo(1);
    assertThat(page.page().size()).isEqualTo(200);
    assertThat(page.page().totalPages()).isEqualTo(2);
    assertThat(page.traceId()).isEqualTo("trace-1");
    ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc).query(anyString(), any(RowMapper.class), arguments.capture());
    Object[] args = arguments.getValue();
    assertThat(args[0]).isEqualTo(7L);
    assertThat(args[1]).isEqualTo("WITHDRAWN");
    assertThat(args[4]).isEqualTo("GENERAL");
    assertThat(args[7]).isEqualTo("13800000000");
    assertThat(args[12]).isEqualTo(hash);
    assertThat(args[13]).isEqualTo("0000");
    assertThat(args[14]).isEqualTo(200);
    assertThat(args[15]).isEqualTo(0);
  }

  @Test
  void summaryAggregatesStatusesOnceAndCountsPendingWithoutLoadingRows() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(rs.getLong("total")).thenReturn(10L);
    when(rs.getLong("submitted")).thenReturn(6L);
    when(rs.getLong("withdrawn")).thenReturn(3L);
    when(rs.getLong("voided")).thenReturn(1L);
    when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(7L)))
        .thenAnswer(invocation -> invocation.getArgument(1, RowMapper.class).mapRow(rs, 0));
    when(jdbc.queryForObject(anyString(), eq(Long.class), eq(7L))).thenReturn(4L);

    assertThat(service.adminOrderCounts(7)).isEqualTo(new OrderQueryService.OrderCounts(10, 6, 3, 1, 4));
    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    verify(jdbc).queryForObject(sql.capture(), any(RowMapper.class), eq(7L));
    assertThat(sql.getValue()).contains("SUM(o.status = 'SUBMITTED')", "SUM(o.status = 'WITHDRAWN')",
        "SUM(o.status = 'VOIDED')", "JOIN activity_customer", "WHERE o.activity_id = ?").doesNotContain("LIMIT");
    verify(jdbc).queryForObject("SELECT COUNT(*) FROM order_change_request WHERE activity_id = ? AND status = 'PENDING'", Long.class, 7L);
    verifyNoMoreInteractions(jdbc);
  }

  @Test
  void summaryReturnsZeroForAnEmptyActivity() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(8L)))
        .thenAnswer(invocation -> invocation.getArgument(1, RowMapper.class).mapRow(rs, 0));
    when(jdbc.queryForObject(anyString(), eq(Long.class), eq(8L))).thenReturn(0L);
    assertThat(service.adminOrderCounts(8)).isEqualTo(new OrderQueryService.OrderCounts(0, 0, 0, 0, 0));
  }

  @Test
  void currentPageReturnsPendingIdsInOneUniqueIndexedJoinAndPreservesNull() throws Exception {
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(101L);
    ResultSet rs = mock(ResultSet.class);
    when(rs.getLong("id")).thenReturn(31L);
    when(rs.getObject("pending_change_request_id", Long.class)).thenReturn(901L, (Long) null);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(invocation -> List.of(invocation.getArgument(1, RowMapper.class).mapRow(rs, 0)));

    assertThat(service.adminOrders(7, null, null, null, 3, 50, "trace").data().getFirst().pendingChangeRequestId()).isEqualTo(901L);
    assertThat(service.adminOrders(7, null, null, null, 3, 50, "trace").data().getFirst().pendingChangeRequestId()).isNull();
    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc, times(2)).query(sql.capture(), any(RowMapper.class), args.capture());
    assertThat(sql.getValue()).contains("LEFT JOIN order_change_request r ON r.pending_order_id = o.id AND r.activity_id = o.activity_id",
        "ORDER BY o.last_modified_at DESC, o.id DESC LIMIT ? OFFSET ?");
    assertThat(args.getValue()[14]).isEqualTo(50);
    assertThat(args.getValue()[15]).isEqualTo(100);
  }

}
