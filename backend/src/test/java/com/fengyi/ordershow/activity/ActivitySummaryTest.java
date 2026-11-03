package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class ActivitySummaryTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final Instant now = Instant.parse("2026-10-31T00:00:00Z");
  private final ActivityService service = new ActivityService(jdbc, Clock.fixed(now, ZoneOffset.UTC));

  private AdminPrincipal admin(String role, Long departmentId) {
    return new AdminPrincipal(1, "fixture", "合成测试", role, departmentId, "部门", false);
  }

  @Test void summaryMapsEffectiveStatusWithOneQueryAndNeverReadsCustomerDetails() throws Exception {
    ResultSet row = mock(ResultSet.class);
    when(row.getLong("id")).thenReturn(7L);
    when(row.getLong("department_id")).thenReturn(2L);
    when(row.getString("activity_code")).thenReturn("FIXTURE");
    when(row.getString("status")).thenReturn("SCHEDULED");
    when(row.getObject("starts_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.minusSeconds(60)));
    when(row.getObject("ends_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.plusSeconds(60)));
    when(row.getObject("event_ends_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.plusSeconds(120)));
    doAnswer(call -> List.of(((RowMapper<?>) call.getArgument(1)).mapRow(row, 0)))
        .when(jdbc).query(anyString(), any(RowMapper.class), any(Object[].class));
    var result = service.listSummaries(admin("SUPER_ADMIN", null));
    assertThat(result).hasSize(1);
    assertThat(result.getFirst().status()).isEqualTo("ACTIVE");
    assertThat(result.getFirst().code()).isEqualTo("FIXTURE");
    verify(jdbc).query(argThat((String sql) -> sql.contains("a.deletion_requested_at IS NULL") && !sql.contains("archived_at IS NULL")
        && !sql.contains("a.*") && !sql.contains("activity_customer") && !sql.contains("a.department_id=?")),
        any(RowMapper.class), eq(new Object[] {}));
    verifyNoMoreInteractions(jdbc);
  }

  @Test void departmentAccountsAndMembersAreLimitedToTheirOwnDepartment() {
    for (String role : List.of("DEPARTMENT_ADMIN", "DEPARTMENT_MEMBER")) {
      clearInvocations(jdbc);
      service.listSummaries(admin(role, 2L));
      verify(jdbc).query(contains("AND a.department_id=?"), any(RowMapper.class), eq(2L));
      verifyNoMoreInteractions(jdbc);
    }
  }

  @Test void accountsWithoutADepartmentNeverReadOtherActivities() {
    assertThat(service.listSummaries(admin("DEPARTMENT_MEMBER", null))).isEmpty();
    verifyNoInteractions(jdbc);
  }
}
