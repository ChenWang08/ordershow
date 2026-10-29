package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.order.OrderData.*;
import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.order.OrderService.ItemView;
import com.fengyi.ordershow.order.OrderService.OrderView;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

class OrderAfterSubmissionTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final OrderRepository repository = new OrderRepository(jdbc, new ObjectMapper());

  @Test
  void assembleSubmittedItemsCombinesCalculatedItemsWithCoveringIndexIds() {
    var product1 = new ProductSnapshot(101L, "M101", "Product 101", "Category", "Line A", "Brand", "Variety", "Spec", "10", "GENERAL", "ALL", false, new BigDecimal("100"), new BigDecimal("0.5"), "img1.png", null, null, null);
    var product2 = new ProductSnapshot(102L, "M102", "Product 102", "Category", "Line B", "Brand", "Variety", "Spec", "10", "GENERAL", "ALL", false, new BigDecimal("80"), new BigDecimal("0.4"), "img2.png", 5L, new BigDecimal("70"), "WHOLE_ORDER");

    var pricing1 = new PricingResult(new BigDecimal("100"), null, new BigDecimal("100"), 5L, null, null, null, "STANDARD", new BigDecimal("500"));
    var pricing2 = new PricingResult(new BigDecimal("70"), 5L, new BigDecimal("80"), 0L, new BigDecimal("70"), 5L, 10L, "WHOLE_ORDER", new BigDecimal("700"));

    var items = List.of(
        new OrderData.CalculatedItem(1, product1, 5L, pricing1, new BigDecimal("2.5")),
        new OrderData.CalculatedItem(2, product2, 10L, pricing2, new BigDecimal("4.0"))
    );

    doAnswer(invocation -> {
      RowCallbackHandler handler = invocation.getArgument(1);
      var rs1 = mock(java.sql.ResultSet.class);
      when(rs1.getInt("line_no")).thenReturn(1);
      when(rs1.getLong("id")).thenReturn(9001L);
      handler.processRow(rs1);

      var rs2 = mock(java.sql.ResultSet.class);
      when(rs2.getInt("line_no")).thenReturn(2);
      when(rs2.getLong("id")).thenReturn(9002L);
      handler.processRow(rs2);
      return null;
    }).when(jdbc).query(eq("SELECT id, line_no FROM order_item WHERE order_id = ? ORDER BY line_no"), any(RowCallbackHandler.class), eq(55L));

    OrderView orderRow = new OrderView(55L, 1L, 2L, "ZY001", "SUBMITTED", "H5", "H5", 1, "GENERAL", "EAST",
        "Branch", "Dealer", "Dealer Full", "139****0000", 1, 15L, new BigDecimal("6.5"), new BigDecimal("1200"),
        Instant.now(), Instant.now(), Instant.now(), null, null, null, null, List.of(), List.of(), List.of());

    when(jdbc.query(contains("FROM customer_order o JOIN activity_customer c"), any(RowMapper.class), eq(55L)))
        .thenReturn(List.of(orderRow));

    OrderView result = repository.orderAfterSubmission(55L, items, false);

    assertThat(result.id()).isEqualTo(55L);
    assertThat(result.items()).hasSize(2);

    ItemView item1 = result.items().get(0);
    assertThat(item1.id()).isEqualTo(9001L);
    assertThat(item1.productId()).isEqualTo(101L);
    assertThat(item1.lineNo()).isEqualTo(1);
    assertThat(item1.materialCode()).isEqualTo("M101");
    assertThat(item1.materialName()).isEqualTo("Product 101");
    assertThat(item1.productLine()).isEqualTo("Line A");
    assertThat(item1.quantity()).isEqualTo(5L);
    assertThat(item1.lineAmount()).isEqualByComparingTo("500");
    assertThat(item1.lineTons()).isEqualByComparingTo("2.5");

    ItemView item2 = result.items().get(1);
    assertThat(item2.id()).isEqualTo(9002L);
    assertThat(item2.productId()).isEqualTo(102L);
    assertThat(item2.lineNo()).isEqualTo(2);
    assertThat(item2.appliedTierMinQuantity()).isEqualTo(5L);
    assertThat(item2.pricingMode()).isEqualTo("WHOLE_ORDER");
    assertThat(item2.lineAmount()).isEqualByComparingTo("700");

    assertThat(result.versions()).isEmpty();
    assertThat(result.operations()).isEmpty();

    // Verify version/operation tables are never queried when includeHistory=false
    verify(jdbc, never()).query(contains("FROM order_version v"), any(RowMapper.class), anyLong());
    verify(jdbc, never()).query(contains("FROM order_operation o"), any(RowMapper.class), anyLong());
  }
}
