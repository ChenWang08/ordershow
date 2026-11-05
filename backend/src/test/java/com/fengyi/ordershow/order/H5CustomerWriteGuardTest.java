package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.GlobalExceptionHandler;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.security.H5Principal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class H5CustomerWriteGuardTest {
  private final H5Principal customer=new H5Principal(1,7,9,"ACT","GENERAL",null,null,null,null,null);
  private final H5CustomerWriteRateLimiter limiter=mock(H5CustomerWriteRateLimiter.class);
  private final OrderRepository repository=mock(OrderRepository.class);
  private final ObjectMapper json=new ObjectMapper();
  private final H5CustomerWriteGuard guard=new H5CustomerWriteGuard(limiter,repository,json);
  private final OrderService.SubmitRequest body=new OrderService.SubmitRequest(0,List.of(new OrderService.SubmitItem(11,1)));

  @Test void anOldDurableReceiptSkipsTheNewOperationBudgetAfterRedisExpiry() {
    when(limiter.enabled()).thenReturn(true);
    when(repository.matchesH5Receipt(eq(7L),eq(9L),eq("ORDER_SUBMIT"),eq("key"),any(),any())).thenReturn(true);
    guard.submit("ACT",customer,body,"key",false);
    var fingerprint=ArgumentCaptor.forClass(byte[].class);
    verify(limiter).check(eq(7L),eq(9L),eq("ORDER_SUBMIT"),eq("key"),fingerprint.capture(),eq(true));
    assertArrayEquals(H5SubmitFingerprint.digest(body,false),fingerprint.getValue());
  }

  @Test void changedBodyCannotBypassLimitingByBorrowingAPersistedKey() {
    when(limiter.enabled()).thenReturn(true);
    when(repository.matchesH5Receipt(anyLong(),anyLong(),anyString(),anyString(),any(),any()))
        .thenThrow(DomainException.conflict("IDEMPOTENCY_KEY_REUSED","different command"));
    assertEquals("IDEMPOTENCY_KEY_REUSED",assertThrows(DomainException.class,()->guard.submit("ACT",customer,body,"key",false)).code());
    verify(limiter,never()).check(anyLong(),anyLong(),anyString(),anyString(),any(),anyBoolean());
  }

  @Test void identityAndKeyAreValidatedBeforeCounterOrReceiptAccess() {
    when(limiter.enabled()).thenReturn(true);
    assertEquals("H5_ACTIVITY_MISMATCH",assertThrows(DomainException.class,()->guard.submit("OTHER",customer,body,"key",false)).code());
    assertEquals("IDEMPOTENCY_KEY_REQUIRED",assertThrows(DomainException.class,()->guard.submit("ACT",customer,body,"",false)).code());
    verifyNoInteractions(repository);verify(limiter,never()).check(anyLong(),anyLong(),anyString(),anyString(),any(),anyBoolean());
  }

  @Test void featureSwitchSkipsBothRedisAndTheExtraReceiptRead() {
    guard.submit("ACT",customer,body,"key",false);verifyNoInteractions(repository);
    verify(limiter,never()).check(anyLong(),anyLong(),anyString(),anyString(),any(),anyBoolean());
  }

  @Test void submitModificationAndWithdrawalApplicationsAllPassThroughTheGuard() {
    var auth=mock(AuthService.class);var service=mock(OrderService.class);var request=new org.springframework.mock.web.MockHttpServletRequest();
    var entryGuard=mock(H5CustomerWriteGuard.class);when(auth.requireH5(request)).thenReturn(customer);
    var orders=new OrderController(service,mock(OrderDraftService.class),auth,entryGuard);
    var changes=new OrderChangeRequestController(service,auth,mock(DepartmentAccessService.class),mock(OrderChangeRequestRepository.class),entryGuard);
    orders.submit("ACT",body,"submit",9L,false,request);
    var modify=new OrderService.ChangeRequestRequest(1,"MODIFY",body.items(),"");
    var withdraw=new OrderService.ChangeRequestRequest(1,"WITHDRAW",List.of(),"");
    changes.create("ACT",modify,"modify",9L,request);changes.create("ACT",withdraw,"withdraw",9L,request);
    orders.withdraw("ACT",new OrderService.WithdrawRequest(1),"legacy",false,request);
    verify(entryGuard).submit("ACT",customer,body,"submit",false);
    verify(entryGuard).changeRequest("ACT",customer,modify,"modify");verify(entryGuard).changeRequest("ACT",customer,withdraw,"withdraw");
    verify(entryGuard).withdraw(eq("ACT"),same(customer),any(),eq("legacy"));
  }

  @Test void httpRejectionIncludesRetryAfterAndNeverStartsTheWriteService() throws Exception {
    var auth=mock(AuthService.class);var service=mock(OrderService.class);var entryGuard=mock(H5CustomerWriteGuard.class);
    when(auth.requireH5(any())).thenReturn(customer);
    doThrow(new H5WriteRateLimitException(1501)).when(entryGuard).submit(anyString(),any(),any(),anyString(),anyBoolean());
    var mvc=MockMvcBuilders.standaloneSetup(new OrderController(service,mock(OrderDraftService.class),auth,entryGuard))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(put("/h5/activities/ACT/order?includeHistory=false").header("Idempotency-Key","key")
        .contentType("application/json").content(json.writeValueAsString(body)))
        .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After","2"))
        .andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.code").value("H5_WRITE_RATE_LIMITED"));
    verifyNoInteractions(service);
  }
}
