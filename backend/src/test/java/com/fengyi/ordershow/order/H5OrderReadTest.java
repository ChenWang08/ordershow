package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.order.OrderService.OrderView;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class H5OrderReadTest {
  @Test void lightweightReadScopesByActivityAndCustomerAndOnlyLoadsCurrentItems() {
    var jdbc = mock(JdbcTemplate.class);
    var row = mock(OrderView.class);
    when(row.id()).thenReturn(7L); when(row.activityId()).thenReturn(3L); when(row.activityCustomerId()).thenReturn(4L);
    when(jdbc.query(contains("WHERE o.activity_id = ? AND o.activity_customer_id = ?"),
        org.mockito.ArgumentMatchers.<RowMapper<OrderView>>any(), eq(3L), eq(4L))).thenReturn(List.of(row));
    var result = new OrderRepository(jdbc,new ObjectMapper()).findByCustomer(3,4,false);
    assertThat(result.id()).isEqualTo(7); assertThat(result.activityId()).isEqualTo(3);
    assertThat(result.activityCustomerId()).isEqualTo(4);
    assertThat(result.versions()).isEmpty(); assertThat(result.operations()).isEmpty();
    verify(jdbc).query(contains("WHERE o.activity_id = ? AND o.activity_customer_id = ?"), any(RowMapper.class), eq(3L), eq(4L));
    verify(jdbc).query(contains("FROM order_item WHERE order_id = ?"), any(RowMapper.class), eq(7L));
    verifyNoMoreInteractions(jdbc);
  }

  @Test void missingCustomerOrderDoesNotLoadAnyDetails() {
    var jdbc = mock(JdbcTemplate.class);
    assertThat(new OrderRepository(jdbc,new ObjectMapper()).findByCustomer(3,4,false)).isNull();
    verify(jdbc).query(contains("WHERE o.activity_id = ? AND o.activity_customer_id = ?"), any(RowMapper.class), eq(3L), eq(4L));
    verifyNoMoreInteractions(jdbc);
  }
}
