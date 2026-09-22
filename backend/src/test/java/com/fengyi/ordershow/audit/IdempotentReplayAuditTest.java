package com.fengyi.ordershow.audit;

import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import com.fengyi.ordershow.security.DepartmentAccessService;

class IdempotentReplayAuditTest {
  @Test void successfulServerMarkedReplayDoesNotDuplicateTheOriginalAudit() {
    var writer = mock(AuditBatchWriter.class);
    var audit = new AuditService(mock(JdbcTemplate.class),mock(DepartmentAccessService.class),writer);
    var request = new MockHttpServletRequest("PUT","/h5/activities/A/order");
    request.setAttribute(AuditService.IDEMPOTENT_REPLAY_ATTRIBUTE,true);
    audit.record(request,new MockHttpServletResponse(),null);
    verifyNoInteractions(writer);
  }
  @Test void clientHeaderCannotSuppressAudit() {
    var writer = mock(AuditBatchWriter.class);
    var audit = new AuditService(mock(JdbcTemplate.class),mock(DepartmentAccessService.class),writer);
    var request = new MockHttpServletRequest("PUT","/h5/activities/A/order");
    request.addHeader(AuditService.IDEMPOTENT_REPLAY_ATTRIBUTE,"true");
    audit.record(request,new MockHttpServletResponse(),null);
    verify(writer).write(any());
  }
}
