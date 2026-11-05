package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class H5ReceiptLookupTest {
  @Test void receiptLookupRecognizesModernAndLegacyHashesAndRejectsAReusedKey() {
    var jdbc=mock(JdbcTemplate.class);var orders=new OrderRepository(jdbc,new ObjectMapper());
    byte[] modern={1,2},legacy={3,4};
    when(jdbc.queryForList(anyString(),eq(7L),eq(9L),eq("ORDER_SUBMIT"),eq("key")))
        .thenReturn(List.of(Map.of("request_hash",modern,"receipt_format","2")));
    assertTrue(orders.matchesH5Receipt(7,9,"ORDER_SUBMIT","key",modern,legacy));
    when(jdbc.queryForList(anyString(),eq(7L),eq(9L),eq("ORDER_SUBMIT"),eq("key")))
        .thenReturn(List.of(Map.of("request_hash",legacy,"receipt_format","1")));
    assertTrue(orders.matchesH5Receipt(7,9,"ORDER_SUBMIT","key",modern,legacy));
    assertEquals("IDEMPOTENCY_KEY_REUSED",assertThrows(DomainException.class,
        ()->orders.matchesH5Receipt(7,9,"ORDER_SUBMIT","key",modern,new byte[]{9})).code());
    assertFalse(orders.matchesH5Receipt(7,10,"ORDER_SUBMIT","key",modern,legacy));
    assertFalse(orders.matchesH5Receipt(7,9,"ORDER_CHANGE_REQUEST","key",modern,legacy));
  }
}
