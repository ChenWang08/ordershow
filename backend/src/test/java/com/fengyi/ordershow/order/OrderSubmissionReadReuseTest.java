package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static com.fengyi.ordershow.order.OrderData.*;
import static com.fengyi.ordershow.order.OrderService.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OrderSubmissionReadReuseTest {
  private final OrderRepository repository = mock(OrderRepository.class);
  private final ActivityService activities = mock(ActivityService.class);
  private final OrderChangeRequestRepository changes = mock(OrderChangeRequestRepository.class);
  private final H5Principal customer = new H5Principal(1, 2, 3, "A", "GENERAL", "EAST", "B", "S", "F", "139****0000");
  private final OrderRow current = new OrderRow(7, 3, "SUBMITTED", 1, 1);
  private final OrderService service = new OrderService(repository, activities, null, new ObjectMapper(), null, null, changes);
  private final ProductSnapshot product = new ProductSnapshot(10, "M", "N", "C", "P", "B", "V", "S", "12", "GENERAL", "ALL", false, new BigDecimal("100"), null, null, null, null, null);

  @BeforeEach void setup() {
    when(activities.orderingActivity("A")).thenReturn(new ActivityService.OrderingActivity(2, Instant.now().plusSeconds(3600)));
    when(repository.lockOrder(2, 3)).thenReturn(current);
    when(repository.currentQuantities(7)).thenReturn(Map.of(10L, 5L));
    when(repository.loadProducts(2, 3, "GENERAL", "B", Set.of(10L))).thenReturn(List.of(product));
    when(repository.updateH5Order(eq(2), anyLong(), any(), any(), eq(current), eq(1))).thenReturn(1);
    when(repository.order(7, false)).thenReturn(mock(OrderView.class));
  }

  @Test void unchangedOrderStillChecksProductEligibilityAndKeepsNoOpSemantics() {
    service.submit("A", customer, new SubmitRequest(1, List.of(new SubmitItem(10, 5))), "key", "trace", false);
    var ordered = inOrder(repository);
    ordered.verify(repository).currentQuantities(7);
    ordered.verify(repository).loadProducts(2, 3, "GENERAL", "B", Set.of(10L));
    ordered.verify(repository).deleteDraft(2, 3);
    verify(repository, never()).deleteCurrentItems(anyLong());
    verify(repository, never()).insertCurrentItems(anyLong(), anyList());
    verify(repository, never()).writeOutbox(anyLong(), anyLong(), anyString(), anyMap());
    verify(repository).completeH5Submission(eq(2L), eq(3L), eq("key"), any());
  }

  @Test void unchangedQuantitiesDoNotBypassAnUnorderableProduct() {
    when(repository.loadProducts(2, 3, "GENERAL", "B", Set.of(10L))).thenReturn(List.of());
    assertThatThrownBy(() -> service.submit("A", customer, new SubmitRequest(1, List.of(new SubmitItem(10, 5))), "key", "trace", false))
        .isInstanceOfSatisfying(DomainException.class, error -> assertThat(error.code()).isEqualTo("PRODUCT_NOT_ORDERABLE"));
    verify(repository, never()).deleteDraft(anyLong(), anyLong());
  }

  @Test void reductionStillRequiresReviewBeforeProductValidation() {
    assertThatThrownBy(() -> service.submit("A", customer, new SubmitRequest(1, List.of(new SubmitItem(10, 4))), "key", "trace", false))
        .isInstanceOfSatisfying(DomainException.class, error -> assertThat(error.code()).isEqualTo("ORDER_CHANGE_REVIEW_REQUIRED"));
    verify(repository, never()).loadProducts(anyLong(), anyLong(), anyString(), anyString(), anySet());
  }

  @Test void increaseUsesOneReadAndWritesBothSnapshotsAndEvent() {
    service.submit("A", customer, new SubmitRequest(1, List.of(new SubmitItem(10, 6))), "key", "trace", false);
    verify(repository, times(1)).currentQuantities(7);
    verify(repository).insertCurrentItems(eq(7L), argThat(items -> items.size() == 1 && items.getFirst().quantity() == 6 && items.getFirst().pricing().lineAmount().compareTo(new BigDecimal("600")) == 0));
    verify(repository).insertVersionItems(anyLong(), argThat(items -> items.getFirst().quantity() == 6));
    verify(repository).writeOutbox(2, 7, "ORDER_SUBMITTED", Map.of("orderId", 7L, "version", 2));
    verify(changes).rejectPending(eq(7L), anyString());
  }

  @Test void removalIsAReductionButAddingANewProductIsNot() {
    assertThat(OrderRepository.hasReducedItems(Map.of(10L, 5L), Map.of(11L, 6L))).isTrue();
    assertThat(OrderRepository.hasReducedItems(Map.of(10L, 5L), Map.of(10L, 5L, 11L, 6L))).isFalse();
  }
}
