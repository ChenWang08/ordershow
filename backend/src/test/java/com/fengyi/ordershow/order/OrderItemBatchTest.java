package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static com.fengyi.ordershow.order.OrderData.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.ArrayList;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class OrderItemBatchTest {
  private CalculatedItem item(int line) {
    var product = new ProductSnapshot(100L + line, "M", "商品", "C", "P", "B", "V", "S", "12",
        "SPECIAL", "ALL", false, new BigDecimal("100"), null, null, null, null, null);
    return new CalculatedItem(line, product, 3,
        OrderPricingCalculator.calculatePrice(product.casePrice(), null, null, null, 3), null);
  }

  @Test
  void boundsBatchesAndPreservesAllSnapshotFieldsAndNulls() {
    var jdbc = mock(JdbcTemplate.class);
    var repository = new OrderRepository(jdbc, new ObjectMapper());
    var batches = new ArrayList<List<Object[]>>();
    when(jdbc.batchUpdate(anyString(), org.mockito.ArgumentMatchers.<List<Object[]>>any()))
        .thenAnswer(call -> { batches.add(List.copyOf(call.getArgument(1))); return new int[0]; });
    var items = IntStream.rangeClosed(1, 201).mapToObj(this::item).toList();
    repository.insertCurrentItems(7, items);
    repository.insertVersionItems(9, items);
    assertThat(batches).extracting(List::size).containsExactly(100, 100, 1, 100, 100, 1);
    var first = items.getFirst();
    var p = first.pricing();
    assertThat(batches.getFirst().getFirst()).containsExactly(7L, 101L, 1, "M", "商品", "C", "P", "B", "V", "S", "12",
        "ALL", false, null, 3L, p.casePriceSnapshot(), p.appliedTierMinQuantity(), p.baseCasePrice(), p.baseQuantity(),
        p.tierCasePrice(), p.tierMinQuantity(), p.tierQuantity(), p.pricingMode(), p.lineAmount(), null, null);
    assertThat(batches.get(3).getFirst()).containsExactly(9L, 1, 101L, "M", "商品", "C", "P", "B", "V", "S", "12",
        "SPECIAL", "ALL", false, null, 3L, p.casePriceSnapshot(), p.appliedTierMinQuantity(), p.baseCasePrice(), p.baseQuantity(),
        p.tierCasePrice(), p.tierMinQuantity(), p.tierQuantity(), p.pricingMode(), p.lineAmount(), null, null);
    assertThat(batches.get(2).getFirst()[2]).isEqualTo(201);
    assertThat(batches.get(5).getFirst()[1]).isEqualTo(201);
    verify(jdbc, never()).update(anyString(), any(Object[].class));
  }

  @Test
  void emptyItemsDoNotTouchDatabaseAndBatchFailuresPropagate() {
    var jdbc = mock(JdbcTemplate.class);
    var repository = new OrderRepository(jdbc, new ObjectMapper());
    repository.insertCurrentItems(7, List.of());
    repository.insertVersionItems(9, List.of());
    verifyNoInteractions(jdbc);
    when(jdbc.batchUpdate(anyString(), org.mockito.ArgumentMatchers.<List<Object[]>>any()))
        .thenThrow(new org.springframework.dao.DataIntegrityViolationException("batch failed"));
    assertThatThrownBy(() -> repository.insertCurrentItems(7, List.of(item(1))))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(() -> repository.insertVersionItems(9, List.of(item(1))))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }
}
