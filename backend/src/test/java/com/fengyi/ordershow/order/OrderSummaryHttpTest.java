package com.fengyi.ordershow.order;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fengyi.ordershow.security.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrderSummaryHttpTest {
  @Test
  void summaryRouteBindsTheActivityAndReturnsCountsWithoutInvokingTheDetailRoute() throws Exception {
    var service = mock(OrderService.class);
    when(service.adminOrderCounts(7)).thenReturn(new OrderQueryService.OrderCounts(10, 6, 3, 1, 2));
    var mvc = MockMvcBuilders.standaloneSetup(new OrderController(service, mock(OrderDraftService.class), mock(AuthService.class), mock(H5CustomerWriteGuard.class))).build();
    mvc.perform(get("/admin/activities/7/orders/summary"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.all").value(10))
        .andExpect(jsonPath("$.data.submitted").value(6)).andExpect(jsonPath("$.data.withdrawn").value(3))
        .andExpect(jsonPath("$.data.voided").value(1)).andExpect(jsonPath("$.data.pending").value(2));
    verify(service).adminOrderCounts(7);
    verifyNoMoreInteractions(service);
  }
}
