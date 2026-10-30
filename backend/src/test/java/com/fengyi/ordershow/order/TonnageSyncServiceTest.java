package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TonnageSyncServiceTest {
  private final TonnageSyncRepository tonnage = mock(TonnageSyncRepository.class);
  private final OrderRepository orders = mock(OrderRepository.class);
  private final DashboardService dashboards = mock(DashboardService.class);
  private final TonnageSyncService service = new TonnageSyncService(tonnage, orders, dashboards);

  @Test
  void recalculatesCurrentSubmittedTonnageAndRefreshesSnapshots() {
    when(tonnage.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 10, "10", "1")));

    assertThat(service.sync(7, 21, new BigDecimal("5"))).isEqualTo(1);

    var sequence = inOrder(orders, tonnage, dashboards);
    sequence.verify(orders).lockPricing(7);
    sequence.verify(tonnage).submittedItems(7, 21);
    sequence.verify(orders).snapshotCurrentVersion(101);
    sequence.verify(tonnage).updateItem(10, new BigDecimal("5"), new BigDecimal("2.000000"));
    sequence.verify(tonnage).updateOrderTotal(101);
    sequence.verify(orders).refreshDashboardSummary(101);
    sequence.verify(orders).writeOutbox(7, 101, "ORDER_TONS_UPDATED", Map.of("orderId", 101L));
    sequence.verify(dashboards).refreshFinalSnapshots(7);
    sequence.verifyNoMoreInteractions();
  }

  @Test
  void clearingTheFactorContributesZeroToTheOrderTonnage() {
    when(tonnage.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 10, "5", "2")));

    assertThat(service.sync(7, 21, null)).isEqualTo(1);

    verify(orders).snapshotCurrentVersion(101);
    verify(tonnage).updateItem(10, null, new BigDecimal("0.000000"));
    verify(tonnage).updateOrderTotal(101);
    verify(orders).writeOutbox(7, 101, "ORDER_TONS_UPDATED", Map.of("orderId", 101L));
    verify(dashboards).refreshFinalSnapshots(7);
  }

  @Test
  void numericallyUnchangedTonnageDoesNotWriteOrEmitEvents() {
    when(tonnage.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 10, "5.00", "2.000000")));

    assertThat(service.sync(7, 21, new BigDecimal("5"))).isZero();

    verify(tonnage, never()).updateItem(anyLong(), any(), any());
    verify(tonnage, never()).updateOrderTotal(anyLong());
    verify(orders, never()).snapshotCurrentVersion(anyLong());
    verify(orders, never()).writeOutbox(anyLong(), anyLong(), anyString(), any());
    verifyNoInteractions(dashboards);
  }

  @Test
  void noSubmittedItemsDoNotRequireAConversionFactor() {
    when(tonnage.submittedItems(7, 21)).thenReturn(List.of());

    assertThat(service.sync(7, 21, null)).isZero();

    verify(tonnage, never()).updateItem(anyLong(), any(), any());
    verify(orders, never()).snapshotCurrentVersion(anyLong());
    verifyNoInteractions(dashboards);
  }

  @Test
  void persistenceFailurePropagatesWithoutPublishingAnEvent() {
    when(tonnage.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 10, "10", "1")));
    var failure = new IllegalStateException("database unavailable");
    doThrow(failure).when(tonnage).updateOrderTotal(101);

    org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.sync(7, 21, new BigDecimal("5"))).isSameAs(failure);

    verify(orders).snapshotCurrentVersion(101);
    verify(tonnage).updateItem(10, new BigDecimal("5"), new BigDecimal("2.000000"));
    verify(orders, never()).writeOutbox(anyLong(), anyLong(), anyString(), any());
    verifyNoInteractions(dashboards);
  }

  private TonnageSyncRepository.CurrentItem item(long id, long orderId, long quantity, String factor, String lineTons) {
    return new TonnageSyncRepository.CurrentItem(id, orderId, quantity,
        factor == null ? null : new BigDecimal(factor), lineTons == null ? null : new BigDecimal(lineTons));
  }
}
