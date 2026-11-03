package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.common.DomainException;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class MemberPermissionServiceTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final MemberPermissionService permissions = new MemberPermissionService(jdbc);
  private AdminPrincipal member(AdminPermission... granted) {
    return new AdminPrincipal(2, "member", "成员", "DEPARTMENT_MEMBER", 1L, "部门", false, Set.of(granted));
  }
  private void check(AdminPrincipal actor, String method, String path) {
    var request = new MockHttpServletRequest(method, "/api/v1" + path);
    request.setContextPath("/api/v1");
    permissions.requireAccess(actor, request);
  }
  @Test void everyModuleIsIndependentAndCanBeRevoked() {
    String[] modules = {"ranking", "products", "customers", "attendees", "orders", "lottery/rules"};
    for (int i = 0; i < modules.length; i++) {
      var granted = AdminPermission.values()[i];
      var actor = member(granted);
      for (int j = 0; j < modules.length; j++) {
        String path = "/admin/activities/1/" + modules[j];
        if (i == j) assertThatCode(() -> check(actor, "GET", path)).doesNotThrowAnyException();
        else assertThatThrownBy(() -> check(actor, "GET", path)).isInstanceOf(DomainException.class);
      }
      String path = "/admin/activities/1/" + modules[i];
      assertThatThrownBy(() -> check(member(), "GET", path)).isInstanceOf(DomainException.class);
    }
  }
  @Test void editorStateRequiresProductPermission() {
    String path="/admin/activities/1/products/42/editor-state";
    check(member(AdminPermission.PRODUCT),"GET",path);
    for(var actor:List.of(member(),member(AdminPermission.WHITELIST),member(AdminPermission.ORDER)))
      assertThatThrownBy(() -> check(actor,"GET",path)).isInstanceOf(DomainException.class);
  }
  @Test void fullPermissionsNeverGrantActivityOrAccountAdministration() {
    var actor = member(AdminPermission.values());
    for (String path : List.of("/admin/activities", "/admin/activities/1", "/admin/activities/1/publish",
        "/admin/activities/1/withdraw-publication", "/admin/activities/1/close", "/admin/activities/1/finish", "/admin/activities/1/reopen",
        "/admin/members", "/admin/users/1", "/admin/departments", "/admin/auth/change-password")) {
      assertThatThrownBy(() -> check(actor, "POST", path)).isInstanceOf(DomainException.class);
    }
    assertThatThrownBy(() -> check(actor, "GET", "/admin/activities/1/audit-logs")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> check(actor, "GET", "/admin/activities/1/new-unclassified-module")).isInstanceOf(DomainException.class);
  }
  @Test void overviewUsesOnlyOverviewPermissionAndKeepsLegacyRankingAccess() {
    for (String resource : List.of("overview", "ranking")) {
      check(member(AdminPermission.OVERVIEW), "GET", "/admin/activities/1/" + resource);
      assertThatThrownBy(() -> check(member(AdminPermission.ORDER), "GET", "/admin/activities/1/" + resource))
          .isInstanceOf(DomainException.class);
      assertThatThrownBy(() -> check(member(), "GET", "/admin/activities/1/" + resource))
          .isInstanceOf(DomainException.class);
    }
  }
  @Test void activityPickerAndOrderDependenciesDoNotRequireOtherModules() {
    check(member(), "GET", "/admin/me");
    check(member(), "GET", "/admin/activities");
    check(member(), "GET", "/admin/activities/1");
    check(member(AdminPermission.ORDER), "GET", "/admin/activities/1/orders/product-options");
    check(member(AdminPermission.ORDER), "GET", "/admin/activities/1/orders/customer-options");
    check(member(AdminPermission.ORDER), "POST", "/admin/activities/1/order-change-requests/2/approve");
    check(member(AdminPermission.ORDER), "POST", "/admin/activities/1/orders/2/void");
  }
  @Test void importPermissionComesFromStoredTaskAndRequestedActivity() {
    when(jdbc.queryForList("SELECT import_type FROM import_task WHERE id=? AND activity_id=?", String.class, 9L, 1L))
        .thenReturn(List.of("WHITELIST"));
    assertThatThrownBy(() -> check(member(AdminPermission.PRODUCT), "POST", "/admin/activities/1/imports/9/confirm")).isInstanceOf(DomainException.class);
    check(member(AdminPermission.WHITELIST), "POST", "/admin/activities/1/imports/9/confirm");
    assertThatThrownBy(() -> check(member(AdminPermission.WHITELIST), "GET", "/admin/activities/2/imports/9"))
        .isInstanceOf(DomainException.class).extracting(e -> ((DomainException)e).code()).isEqualTo("IMPORT_TASK_NOT_FOUND");
  }
  @Test void administratorRetainsAllModulesButUnknownRoleHasNoImplicitPrivileges() {
    check(new AdminPrincipal(1,"admin","管理员","DEPARTMENT_ADMIN",1L,"部门",false), "POST", "/admin/activities/1/publish");
    assertThatThrownBy(() -> check(new AdminPrincipal(3,"unknown","未知","UNKNOWN",1L,"部门",false), "POST", "/admin/users"))
        .isInstanceOf(DomainException.class);
  }
  @Test void exportsAlwaysRequireSuperAdminIncludingDepartmentManagersAndOrderMembers() {
    var root=new AdminPrincipal(1,"root","系统管理员","SUPER_ADMIN",null,null,false);
    var department=new AdminPrincipal(3,"dept","部门管理员","DEPARTMENT_ADMIN",1L,"部门",false);
    for(String resource:List.of("exports","exports/3","exports/3/download","exports/3/cancel","orders/export")) {
      String path="/admin/activities/1/"+resource;
      check(root,"GET",path);
      for(var denied:List.of(department,member(AdminPermission.ORDER)))
        assertThatThrownBy(()->check(denied,"GET",path)).isInstanceOf(DomainException.class)
            .extracting(e->((DomainException)e).code()).isEqualTo("SUPER_ADMIN_REQUIRED");
    }
  }
}
