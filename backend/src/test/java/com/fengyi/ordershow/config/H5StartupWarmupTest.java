package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.H5CatalogService;
import com.fengyi.ordershow.order.OrderService;
import com.fengyi.ordershow.security.H5Principal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

class H5StartupWarmupTest {
  final JdbcTemplate jdbc=mock(JdbcTemplate.class);
  final H5CatalogService catalog=mock(H5CatalogService.class);
  final OrderService orders=mock(OrderService.class);
  final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
  final H5Principal customer=new H5Principal(0,3,4,"A","SPECIAL",null,null,null,null,null);
  H5StartupWarmup warmup(boolean enabled) {
    when(manager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));
    return new H5StartupWarmup(jdbc,catalog,orders,new ObjectMapper(),manager,enabled);
  }
  @Test void readsAndSerializesBoundedSamplesWithoutWritesOrHistory() {
    when(jdbc.query(anyString(),org.mockito.ArgumentMatchers.<RowMapper<H5Principal>>any())).thenReturn(List.of(customer));
    warmup(true).run(null);
    verify(catalog,times(32)).products("A",customer,null,null);verify(orders,times(32)).current("A",customer,false);
    verify(jdbc).query(contains("LIMIT 4"),any(RowMapper.class));verifyNoMoreInteractions(jdbc,catalog,orders);
    verify(manager,times(33)).commit(any());verify(manager,never()).rollback(any());
  }
  @Test void disabledOrEmptyCatalogDoesNotMakeBusinessCalls() {
    warmup(false).run(null);verifyNoInteractions(jdbc,catalog,orders);
    warmup(true).run(null);verifyNoInteractions(catalog,orders);
  }
  @Test void queryFailureDoesNotSilentlyMarkStartupSuccessful() {
    when(jdbc.query(anyString(),org.mockito.ArgumentMatchers.<RowMapper<H5Principal>>any())).thenReturn(List.of(customer));
    when(catalog.products("A",customer,null,null)).thenThrow(new IllegalStateException("database failure"));
    assertThatThrownBy(()->warmup(true).run(null)).isInstanceOf(IllegalStateException.class);
    verify(manager).commit(any());verify(manager,never()).rollback(any());verifyNoInteractions(orders);
  }
}
