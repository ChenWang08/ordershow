package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.order.OrderService.ItemView;
import com.fengyi.ordershow.order.OrderService.OrderVersionView;
import com.fengyi.ordershow.order.OrderService.OrderView;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class OrderSubmitWritePathTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
  private final OrderRepository repository = new OrderRepository(jdbc, json);

  @Test
  void snapshotCopiesCurrentLinesIntoTheStillCurrentVersion() {
    repository.snapshotCurrentVersion(9);
    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    verify(jdbc).update(sql.capture(), eq(9L));
    assertThat(sql.getValue())
        .contains("INSERT INTO order_version_item")
        .contains("o.customer_type")
        .contains("v.version_no = o.current_version_no")
        .contains("NOT EXISTS")
        .doesNotContain("order_version_item old");
  }

  @Test
  void saveRepricedSnapshotsBeforeThePriceUpdateAndDoesNotCopyVersionItemsAgain() {
    List<String> updates = new ArrayList<>();
    when(jdbc.update(anyString(), any(Object[].class))).thenAnswer(invocation -> {
      updates.add(invocation.getArgument(0));
      return 1;
    });
    when(jdbc.queryForObject(contains("request_idempotency_key"), eq(Long.class), any(), any())).thenReturn(4L);
    when(jdbc.queryForObject(contains("current_version_no"), eq(Integer.class), any())).thenReturn(3);
    var price = new PricingResult(new BigDecimal("110"), new BigDecimal("110"), 2L, null, null, 0L,
        "STANDARD", null, new BigDecimal("220"));
    repository.saveRepriced(1, 9, Map.of(10L, price), 5, "价格同步", "batch-key");
    assertThat(updates.get(0)).contains("INSERT INTO order_version_item").contains("o.customer_type");
    assertThat(updates.get(1)).contains("UPDATE order_item SET case_price");
    assertThat(updates).noneMatch(sql -> sql.contains("order_version_item old"));
  }

  @Test
  void currentVersionWithoutLinesProjectsOrderItemsAndAnOlderEmptyVersionStaysEmpty() {
    ItemView item = new ItemView(100, 10L, 1, "M", "N", "P", "S", "12", 6,
        new BigDecimal("100"), null, new BigDecimal("100"), 6L, null, null, null, null, new BigDecimal("600"), null, null);
    OrderVersionView older = version(3, 1);
    OrderVersionView current = version(4, 2);
    when(jdbc.query(eq("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no"), any(RowMapper.class), eq(9L)))
        .thenReturn(List.of(item));
    List<OrderVersionView> result = repository.withCurrentVersionItems(9, 2, List.of(older, current));
    assertThat(result.get(0).items()).isEmpty();
    assertThat(result.get(1).items()).containsExactly(item);
  }

  @Test
  void aCurrentVersionThatAlreadyHasLinesIsNotReplacedByLiveItems() {
    OrderRepository orders = spy(repository);
    ItemView kept = new ItemView(50, 10L, 1, "M", "N", "P", "S", "12", 5,
        new BigDecimal("80"), null, new BigDecimal("80"), 5L, null, null, null, null, new BigDecimal("400"), null, null);
    OrderVersionView current = new OrderVersionView(4, 2, 6, BigDecimal.ONE, new BigDecimal("100"),
        Instant.EPOCH, "H5", null, null, List.of(kept));
    doReturn(List.of(version(3, 1), current)).when(orders).withVersionItems(any());
    when(jdbc.query(eq("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no"), any(RowMapper.class), eq(9L)))
        .thenReturn(List.of(new ItemView(99, 10L, 1, "M", "N", "P", "S", "12", 5,
            new BigDecimal("100"), null, new BigDecimal("100"), 5L, null, null, null, null, new BigDecimal("500"), null, null)));
    List<OrderVersionView> result = orders.withCurrentVersionItems(9, 2, List.of(version(3, 1), current));
    assertThat(result.get(0).items()).isEmpty();
    assertThat(result.get(1).items()).containsExactly(kept);
    verify(jdbc).query(eq("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no"), any(RowMapper.class), eq(9L));
  }

  @Test
  void partialPriceSnapshotMergesUnchangedLinesAndKeepsOriginalPrices() {
    OrderRepository orders = spy(repository);
    ItemView frozen = new ItemView(50, 10L, 1, "M", "N", "P", "S", "12", 5,
        new BigDecimal("80"), null, new BigDecimal("80"), 5L, null, null, null, null, new BigDecimal("400"), null, null);
    ItemView other = new ItemView(60, 11L, 2, "M2", "N2", "P", "S", "12", 1,
        new BigDecimal("20"), null, new BigDecimal("20"), 1L, null, null, null, null, new BigDecimal("20"), null, null);
    var current = new OrderVersionView(4, 2, 6, BigDecimal.ONE, new BigDecimal("420"), Instant.EPOCH, "H5", null, null, List.of(frozen));
    doReturn(List.of(current)).when(orders).withVersionItems(any());
    when(jdbc.query(eq("SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no"), any(RowMapper.class), eq(9L))).thenReturn(List.of(other));
    assertThat(orders.withCurrentVersionItems(9, 2, List.of(current)).getFirst().items()).containsExactly(frozen, other);
  }

  @Test
  void loadProductsSkipsDealerProbesWhenTheActivityHasNoDealerScope() {
    when(jdbc.queryForObject(contains("activity_product_dealer_scope"), eq(Integer.class), eq(14L))).thenReturn(0);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
    repository.loadProducts(14, 3, "GENERAL", "Branch", Set.of(10L, 11L));
    String sql = productSql();
    assertThat(sql).contains("ROW_NUMBER()").contains("activity_product_branch_scope").contains("activity_product_price_tier")
        .contains("WHITELIST").contains("current_version_id");
    assertThat(sql).doesNotContain("activity_product_dealer_member").doesNotContain("LIMIT 1");
  }

  @Test
  void loadProductsKeepsTheDealerPredicateWhenTheActivityHasScopeRows() {
    when(jdbc.queryForObject(contains("activity_product_dealer_scope"), eq(Integer.class), eq(14L))).thenReturn(1);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
    repository.loadProducts(14, 3, "GENERAL", "Branch", Set.of(10L));
    String sql = productSql();
    assertThat(sql).contains("activity_product_dealer_member").contains("activity_product_dealer_scope")
        .contains("activity_product_branch_scope").contains("ROW_NUMBER()");
  }

  @Test
  void completedSubmissionStoresOnlyTheReplayPointer() throws Exception {
    java.util.concurrent.atomic.AtomicReference<String> captured = new java.util.concurrent.atomic.AtomicReference<>();
    when(jdbc.update(anyString(), any(Object[].class))).thenAnswer(invocation -> {
      for (Object argument : invocation.getArguments()) rememberJson(captured, argument);
      return 1;
    });
    repository.completeH5Submission(1, 3, "k", orderView(), false);
    JsonNode node = json.readTree(captured.get());
    assertThat(node.path("format").asInt()).isEqualTo(2);
    assertThat(node.path("orderId").asLong()).isEqualTo(11);
    assertThat(node.path("orderVersion").asInt()).isEqualTo(1);
    assertThat(node.path("includeHistory").asBoolean()).isFalse();
    assertThat(node.has("resultJson")).isFalse();
  }

  @Test
  void replayReturnsLatestForBothCompactAndPreviouslyStoredResponses() throws Exception {
    OrderRepository orders = spy(repository);
    byte[] hash = new byte[] {7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    OrderView stored = orderView();
    OrderView reread = json.readValue(json.writeValueAsString(stored).replace("\"currentVersion\":1", "\"currentVersion\":2"), OrderView.class);
    java.util.concurrent.atomic.AtomicReference<List<Map<String, Object>>> rows = new java.util.concurrent.atomic.AtomicReference<>();
    when(jdbc.update(anyString(), any(Object[].class))).thenReturn(0);
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenAnswer(invocation -> rows.get());
    rows.set(List.of(row(hash, pointer(false))));
    doReturn(reread).when(orders).order(11L, false);
    assertThat(orders.beginH5Submission(1, 3, "k", hash, hash, false)).isEqualTo(reread);

    rows.set(List.of(row(hash, pointer(true))));
    doReturn(reread).when(orders).order(11L, true);
    assertThat(orders.beginH5Submission(1, 3, "k", hash, hash, true).currentVersion()).isEqualTo(2);
    verify(orders).order(11L, true);

    String legacy = json.writeValueAsString(Map.of("format", 2, "orderId", 11, "orderVersion", 1,
        "resultJson", json.writeValueAsString(stored)));
    rows.set(List.of(row(hash, legacy)));
    // Confirmed business rule applies across upgrades too: an old response snapshot
    // must not hide a later administrator edit from a recovering phone client.
    assertThat(orders.beginH5Submission(1, 3, "k", hash, hash, false)).isEqualTo(reread);
    assertThat(orders.beginH5Submission(1, 3, "k", hash, hash, true)).isEqualTo(reread);
    verify(orders, times(2)).order(11L, false);
    verify(orders, times(2)).order(11L, true);

    rows.set(List.of(row(hash, "{\"orderId\":11}")));
    assertThatThrownBy(() -> orders.beginH5Submission(1, 3, "k", hash, hash, false))
        .isInstanceOf(DomainException.class)
        .extracting(error -> ((DomainException) error).code())
        .isEqualTo("IDEMPOTENCY_RESULT_UNAVAILABLE");
  }

  private static void rememberJson(java.util.concurrent.atomic.AtomicReference<String> captured, Object argument) {
    if (argument instanceof String text && text.startsWith("{")) captured.set(text);
    if (argument instanceof Object[] values) {
      for (Object value : values) rememberJson(captured, value);
    }
  }

  private String productSql() {
    ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
    verify(jdbc).query(sql.capture(), any(RowMapper.class), any(Object[].class));
    return sql.getValue();
  }

  private Map<String, Object> row(byte[] hash, String response) {
    Map<String, Object> row = new HashMap<>();
    row.put("request_hash", hash);
    row.put("status", "COMPLETED");
    row.put("response_json", response);
    return row;
  }

  private String pointer(boolean includeHistory) throws Exception {
    return json.writeValueAsString(Map.of("format", 2, "orderId", 11, "orderVersion", 1, "includeHistory", includeHistory));
  }

  private OrderView orderView() throws Exception {
    return json.readValue("""
        {"id":11,"currentVersion":1,"totalAmount":1.00,"items":[],"versions":[],"operations":[]}
        """, OrderView.class);
  }

  private static OrderVersionView version(long id, int number) {
    return new OrderVersionView(id, number, 6, BigDecimal.ONE, new BigDecimal("100"), Instant.EPOCH, "H5", null, null, List.of());
  }
}
