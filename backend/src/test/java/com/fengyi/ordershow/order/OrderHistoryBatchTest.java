package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.order.OrderService.OrderVersionView;
import java.sql.ResultSet;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

class OrderHistoryBatchTest {
  @Test
  void mapsItemsToTheirVersionsAndPreservesVersionAndLineOrder() throws Exception {
    JdbcTemplate jdbc=mock(JdbcTemplate.class);OrderRepository repository=new OrderRepository(jdbc,new ObjectMapper());
    OrderVersionView newest=mock(OrderVersionView.class), oldest=mock(OrderVersionView.class);
    when(newest.id()).thenReturn(9L);when(newest.version()).thenReturn(2);
    when(oldest.id()).thenReturn(7L);when(oldest.version()).thenReturn(1);
    doAnswer(call->{
      RowCallbackHandler callback=call.getArgument(1);
      for(long[] values:new long[][]{{7,71,1},{7,72,2},{9,91,1}}) {
        ResultSet row=mock(ResultSet.class);when(row.getLong("order_version_id")).thenReturn(values[0]);
        when(row.getLong("id")).thenReturn(values[1]);when(row.getInt("line_no")).thenReturn((int)values[2]);
        when(row.getLong("quantity")).thenReturn(5L);callback.processRow(row);
      }return null;
    }).when(jdbc).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
    var result=repository.withVersionItems(List.of(newest,oldest));
    assertThat(result).extracting(OrderVersionView::version).containsExactly(2,1);
    assertThat(result.getFirst().items()).extracting(OrderService.ItemView::id).containsExactly(91L);
    assertThat(result.get(1).items()).extracting(OrderService.ItemView::id).containsExactly(71L,72L);
    verify(jdbc,times(1)).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
  }
}
