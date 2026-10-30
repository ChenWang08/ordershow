package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PriceSyncServiceTest {
  private final PriceSyncRepository prices = mock(PriceSyncRepository.class);
  private final OrderRepository orders = mock(OrderRepository.class);
  private final DashboardService dashboards = mock(DashboardService.class);
  private final ActivityService activities = mock(ActivityService.class);
  private final PriceSyncService service = new PriceSyncService(prices, orders, dashboards, activities);

  @Test
  void doesNothingWhenThereAreNoSubmittedItemsEvenIfThePriceIsMissing() {
    when(prices.submittedItems(7, 21)).thenReturn(List.of());
    assertThat(service.sync(7, 21, null, null, null, null)).isZero();
    var sequence = inOrder(orders, prices);
    sequence.verify(orders).lockPricing(7);
    sequence.verify(prices).submittedItems(7, 21);
    verify(prices, never()).updateItem(anyLong(), any());
    verify(orders, never()).snapshotCurrentVersion(anyLong());
    verifyNoInteractions(dashboards);
  }

  @Test
  void rejectsNonPositivePricesBeforeMutatingCurrentOrders() {
    when(prices.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 2, "100")));
    assertThatThrownBy(() -> service.sync(7, 21, BigDecimal.ZERO, null, null, null))
        .isInstanceOf(DomainException.class)
        .satisfies(error -> assertThat(((DomainException) error).code()).isEqualTo("PRODUCT_PRICE_REQUIRED"));
    verify(prices, never()).updateItem(anyLong(), any());
    verify(prices, never()).updateOrderTotal(anyLong());
    verify(orders, never()).snapshotCurrentVersion(anyLong());
    verify(orders, never()).writeOutbox(anyLong(), anyLong(), anyString(), any());
    verifyNoInteractions(dashboards);
  }

  @Test
  void numericallyUnchangedPricesDoNotWriteOrEmitEvents() {
    when(prices.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 2, "100")));
    assertThat(service.sync(7, 21, new BigDecimal("100.00"), null, null, null)).isZero();
    verify(prices, never()).updateItem(anyLong(), any());
    verify(prices, never()).updateOrderTotal(anyLong());
    verify(orders, never()).snapshotCurrentVersion(anyLong());
    verify(orders, never()).writeOutbox(anyLong(), anyLong(), anyString(), any());
    verifyNoInteractions(dashboards);
  }

  @Test
  void updatesEachItemThenItsOrderAndEventBeforeRefreshingSnapshotsOnce() {
    when(prices.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 2, "100"), item(11, 102, 3, "100")));
    assertThat(service.sync(7, 21, new BigDecimal("110"), null, null, null)).isEqualTo(2);
    var sequence = inOrder(orders, prices, dashboards);
    sequence.verify(orders).lockPricing(7);
    sequence.verify(prices).submittedItems(7, 21);
    sequence.verify(orders).snapshotCurrentVersion(101);
    sequence.verify(prices).updateItem(eq(10L), any());
    sequence.verify(prices).updateOrderTotal(101);
    sequence.verify(orders).refreshDashboardSummary(101);
    sequence.verify(orders).writeOutbox(7, 101, "ORDER_PRICE_UPDATED", Map.of("orderId", 101L));
    sequence.verify(orders).snapshotCurrentVersion(102);
    sequence.verify(prices).updateItem(eq(11L), any());
    sequence.verify(prices).updateOrderTotal(102);
    sequence.verify(orders).refreshDashboardSummary(102);
    sequence.verify(orders).writeOutbox(7, 102, "ORDER_PRICE_UPDATED", Map.of("orderId", 102L));
    sequence.verify(dashboards).refreshFinalSnapshots(7);
    sequence.verifyNoMoreInteractions();
  }

  @Test
  void persistenceFailurePropagatesToTheTransactionWithoutPublishingAnEvent() {
    when(prices.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 2, "100")));
    var failure = new IllegalStateException("database unavailable");
    doThrow(failure).when(prices).updateOrderTotal(101);
    assertThatThrownBy(() -> service.sync(7, 21, new BigDecimal("110"), null, null, null)).isSameAs(failure);
    verify(orders).snapshotCurrentVersion(101);
    verify(prices).updateItem(eq(10L), any());
    verify(orders, never()).writeOutbox(anyLong(), anyLong(), anyString(), any());
    verifyNoInteractions(dashboards);
  }

  @Test
  void backfillRejectsInactiveActivitiesBeforeReadingProducts() {
    var activity = mock(ActivityService.ActivityView.class);
    when(activity.status()).thenReturn("CLOSED");
    when(activities.byId(7)).thenReturn(activity);
    assertThatThrownBy(() -> service.backfill(7)).isInstanceOf(DomainException.class)
        .satisfies(error -> assertThat(((DomainException) error).code()).isEqualTo("ACTIVITY_NOT_ACTIVE"));
    verify(orders).lockPricing(7);
    verifyNoInteractions(prices, dashboards);
  }

  @Test
  void backfillPreservesTheActivityLockAndPerProductSynchronization() {
    var activity = mock(ActivityService.ActivityView.class);
    when(activity.status()).thenReturn("ACTIVE");
    when(activities.byId(7)).thenReturn(activity);
    when(prices.currentProducts(7)).thenReturn(List.of(new PriceSyncRepository.CatalogPrice(21, new BigDecimal("110"), null, null, null)));
    when(prices.submittedItems(7, 21)).thenReturn(List.of(item(10, 101, 2, "100")));
    assertThat(service.backfill(7)).isEqualTo(1);
    verify(orders, times(2)).lockPricing(7);
    verify(prices).updateOrderTotal(101);
    verify(dashboards).refreshFinalSnapshots(7);
  }

  private PriceSyncRepository.CurrentItem item(long id, long orderId, long quantity, String price) {
    var base = new BigDecimal(price);
    return new PriceSyncRepository.CurrentItem(id, orderId, quantity, base, base, null, null, null,
        base.multiply(BigDecimal.valueOf(quantity)));
  }
}
