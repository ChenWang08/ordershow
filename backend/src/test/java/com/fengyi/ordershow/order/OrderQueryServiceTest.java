package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

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
  void exportKeepsRequestedDetailStatusButUsesSubmittedOrdersForTotals() {
    service.exportData(9, "WITHDRAWN", "SPECIAL", "客户名称");

    ArgumentCaptor<Object[]> summaries = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc).query(anyString(), any(RowMapper.class), summaries.capture());
    assertThat(summaries.getValue()[1]).isEqualTo("WITHDRAWN");
    ArgumentCaptor<Object[]> detailsAndTotals = ArgumentCaptor.forClass(Object[].class);
    org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(3)).queryForList(anyString(), detailsAndTotals.capture());
    List<Object[]> args = detailsAndTotals.getAllValues();
    assertThat(args.get(0)[1]).isEqualTo("WITHDRAWN");
    assertThat(args.get(1)[1]).isEqualTo("SUBMITTED");
    assertThat(args.get(2)[1]).isEqualTo("SUBMITTED");
    for (Object[] values : args) {
      assertThat(values[0]).isEqualTo(9L);
      assertThat(values[4]).isEqualTo("SPECIAL");
      assertThat(values[7]).isEqualTo("客户名称");
    }
  }
}
