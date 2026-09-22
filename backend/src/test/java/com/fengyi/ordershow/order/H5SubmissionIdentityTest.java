package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.H5Principal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class H5SubmissionIdentityTest {
  @Test void changedCookieCannotSubmitTheStoredCartAsADifferentCustomer() {
    var service = mock(OrderService.class);
    var auth = mock(AuthService.class);
    var request = new MockHttpServletRequest();
    var customer = new H5Principal(1,2,3,"A","GENERAL","R","B","short","full","masked");
    when(auth.requireH5(request)).thenReturn(customer);
    var controller = new OrderController(service,mock(OrderDraftService.class),auth);
    var body = new OrderService.SubmitRequest(0,List.of(new OrderService.SubmitItem(4,5)));
    assertEquals("H5_CUSTOMER_CHANGED",assertThrows(DomainException.class,
        () -> controller.submit("A",body,"key",9L,false,request)).code());
    verifyNoInteractions(service);
    when(service.submit(eq("A"),same(customer),same(body),eq("key"),eq("unknown"),eq(false),any(Runnable.class)))
        .thenAnswer(call -> { ((Runnable)call.getArgument(6)).run(); return null; });
    controller.submit("A",body,"key",3L,false,request);
    assertEquals(true,request.getAttribute(AuditService.IDEMPOTENT_REPLAY_ATTRIBUTE));
  }
}
