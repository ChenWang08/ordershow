package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ActivityLiveRoomTest {
  @Test void validatesAndPreservesFullLinks() {
    String url = "https://example.weizan.cn/v3/course/alive/123?v=456#chat";
    assertThat(ActivityService.validateLiveRoomUrl(" " + url + " ")).isEqualTo(url);
    assertThat(ActivityService.validateLiveRoomUrl(" ")).isNull();
    for (String invalid : new String[]{"javascript:alert(1)", "http://example.com", "https://", "https://user:pass@example.com", "https://example.com\\evil", "https://example.com/" + "a".repeat(2048)}) {
      assertThatThrownBy(() -> ActivityService.validateLiveRoomUrl(invalid)).isInstanceOf(DomainException.class);
    }
  }

  @Test void updatesOnlyTheRequestedActivityWithVersionAndScopeChecks() {
    var jdbc = mock(JdbcTemplate.class);
    var access = mock(DepartmentAccessService.class);
    var admin = new AdminPrincipal(8, "admin", "Admin", "DEPARTMENT_ADMIN", 2L, "D", false);
    var service = spy(new ActivityService(jdbc, Clock.systemUTC(), ignored -> {}, access));
    doReturn(null).when(service).byId(42);
    when(jdbc.update(anyString(), nullable(String.class), eq(8L), eq(42L), eq(3))).thenReturn(1);
    service.updateLiveRoom(42, 3, "https://example.com/live/123", admin);
    verify(access).requireActivityAccess(admin, 42);
    verify(jdbc).update(contains("WHERE id = ? AND version = ?"), eq("https://example.com/live/123"), eq(8L), eq(42L), eq(3));
    service.updateLiveRoom(42, 3, "", admin);
    verify(jdbc).update(anyString(), isNull(), eq(8L), eq(42L), eq(3));
    assertThatThrownBy(() -> service.updateLiveRoom(42, 2, "", admin)).isInstanceOf(DomainException.class);
  }

  @Test void membersCannotChangeTheLiveRoom() {
    var jdbc = mock(JdbcTemplate.class);
    var access = mock(DepartmentAccessService.class);
    var service = new ActivityService(jdbc, Clock.systemUTC(), ignored -> {}, access);
    var member = new AdminPrincipal(9, "member", "Member", "DEPARTMENT_MEMBER", 2L, "D", false);
    assertThatThrownBy(() -> service.updateLiveRoom(42, 0, "https://example.com", member)).isInstanceOf(DomainException.class);
    verifyNoInteractions(jdbc);
  }
}
