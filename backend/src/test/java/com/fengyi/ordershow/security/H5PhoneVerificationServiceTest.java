package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;

class H5PhoneVerificationServiceTest {
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final AuthService auth = mock(AuthService.class);
  final CryptoService crypto = mock(CryptoService.class);
  final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
  final SimpleMeterRegistry meters = new SimpleMeterRegistry();
  final TransactionStatus status = mock(TransactionStatus.class);
  final MockHttpServletResponse response = new MockHttpServletResponse();
  final H5PhoneVerificationService service = new H5PhoneVerificationService(jdbc, auth, crypto, manager, meters);

  H5PhoneVerificationServiceTest() {
    when(manager.getTransaction(any(TransactionDefinition.class))).thenReturn(status);
    when(crypto.lookupHash(anyString())).thenReturn(new byte[32]);
    when(auth.createH5Session(any(), any(), any())).thenAnswer(call -> new AuthService.H5LoginResult(call.getArgument(0), "csrf"));
  }

  H5Principal customer(long id, String type) { return new H5Principal(0, 1, id, "ENTRY", type, "EAST", "branch", "short", "full", "139****0001"); }
  void rows(H5Principal... rows) { when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(rows)); }
  H5PhoneVerificationService.VerificationResult perform(String type, String phone) {
    return service.verify("ENTRY", type, phone, new MockHttpServletRequest(), response);
  }

  @Test void invalidInputNeverAcquiresAConnection() {
    assertThatThrownBy(() -> perform(null, "123")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> perform("OTHER", "13900000001")).isInstanceOf(DomainException.class);
    verifyNoInteractions(manager, jdbc, auth);
    assertThat(meters.get("order_show.h5.verify.total").tag("outcome", "rejected").timer().count()).isEqualTo(2);
  }

  @Test void uniqueIdentityNeedsOneLookupAndOneSessionCreation() {
    rows(customer(1, "GENERAL"));
    var result = perform(null, "139-0000-0001");
    assertThat(result.selectionRequired()).isFalse();
    assertThat(result.customer().regionCode()).isEqualTo("EAST");
    verify(crypto).lookupHash("13900000001");
    verify(jdbc).query(anyString(), any(RowMapper.class), any(Object[].class));
    verify(auth).createH5Session(any(), any(), any());
    verify(manager).commit(status);
    assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    assertThat(meters.get("order_show.h5.verify.stage").tag("stage", "transaction_finish").timer().count()).isEqualTo(1);
  }

  @Test void choiceContainsOnlyTypesAndCreatesNoSession() {
    rows(customer(1, "GENERAL"), customer(2, "SPECIAL"));
    var result = perform(null, "13900000001");
    assertThat(result.selectionRequired()).isTrue();
    assertThat(result.customerTypes()).containsExactly("GENERAL", "SPECIAL");
    assertThat(result.customer()).isNull(); assertThat(result.csrfToken()).isNull();
    verifyNoInteractions(auth); assertThat(response.getHeaders("Set-Cookie")).isEmpty();
  }

  @Test void confirmationUsesPhoneAndTypeAndNeverTrustsAnEarlierChoice() {
    rows(customer(2, "SPECIAL"));
    assertThat(perform("SPECIAL", "13900000001").customer().customerType()).isEqualTo("SPECIAL");
    verify(jdbc).query(contains("AND c.customer_type = ?"), any(RowMapper.class), eq("ENTRY"), any(byte[].class), eq("SPECIAL"));
    rows();
    assertThatThrownBy(() -> perform("SPECIAL", "13900000001")).isInstanceOf(DomainException.class);
    verify(auth, times(1)).createH5Session(any(), any(), any());
  }

  @Test void duplicateSameTypeOrMixedAllNeverGuessesAnIdentity() {
    for (var candidates : List.of(List.of(customer(1, "GENERAL"), customer(2, "GENERAL")),
        List.of(customer(1, "ALL"), customer(2, "SPECIAL")))) {
      rows(candidates.toArray(H5Principal[]::new));
      assertThatThrownBy(() -> perform(null, "13900000001")).isInstanceOfSatisfying(DomainException.class,
          e -> assertThat(e.code()).isEqualTo("WHITELIST_IDENTITY_AMBIGUOUS"));
    }
    verifyNoInteractions(auth);
  }

  @Test void insertFailureRollsBackAndIsCountedAsAnError() {
    rows(customer(1, "ALL"));
    when(auth.createH5Session(any(), any(), any())).thenThrow(new IllegalStateException("insert failed"));
    assertThatThrownBy(() -> perform(null, "13900000001")).isInstanceOf(IllegalStateException.class);
    verify(manager).rollback(status); verify(manager, never()).commit(any());
    assertThat(meters.get("order_show.h5.verify.total").tag("outcome", "error").timer().count()).isEqualTo(1);
  }
}
