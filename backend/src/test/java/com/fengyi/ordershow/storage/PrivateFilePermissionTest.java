package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.*;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class PrivateFilePermissionTest {
  final StorageService storage = mock(StorageService.class);
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final AuthService auth = mock(AuthService.class);
  final DepartmentAccessService departments = mock(DepartmentAccessService.class);
  final FileController controller = new FileController(storage, jdbc, auth, departments);
  final MockHttpServletRequest request = new MockHttpServletRequest();
  void file(String purpose) {
    when(jdbc.queryForList("SELECT activity_id,file_purpose FROM stored_file WHERE id=? AND deleted_at IS NULL", 3L))
        .thenReturn(List.of(Map.of("activity_id", 1L, "file_purpose", purpose)));
    when(storage.meta(3)).thenReturn(new StorageService.FileMeta(3,"bucket","key","file","image/png",0));
    when(storage.read(3)).thenReturn(new byte[0]);
  }
  @Test void publicImagesRemainAvailableToH5WithoutAnAdminSession() {
    file("PRODUCT_IMAGE");
    assertThat(controller.get(3, request).getStatusCode().value()).isEqualTo(200);
    verifyNoInteractions(auth, departments);
  }
  @Test void activityBackgroundsArePublicWithoutAnAdminSession() {
    file("ACTIVITY_BACKGROUND");
    assertThat(controller.get(3, request).getStatusCode().value()).isEqualTo(200);
    verifyNoInteractions(auth, departments);
  }
  @Test void sourceSheetsRequireTheirActualModulePermissionBeforeReadingBytes() {
    file("IMPORT_SOURCE");
    var actor = new AdminPrincipal(2,"member","成员","DEPARTMENT_MEMBER",1L,"部门",false,Set.of(AdminPermission.ORDER));
    when(auth.requireAdmin(request)).thenReturn(actor);
    when(jdbc.queryForList("SELECT import_type FROM import_task WHERE activity_id=? AND (source_file_id=? OR auxiliary_file_id=?)", String.class,1L,3L,3L))
        .thenReturn(List.of("WHITELIST"));
    assertThatThrownBy(() -> controller.get(3,request)).isInstanceOf(DomainException.class);
    verify(departments).requireActivityAccess(actor,1);
    verify(storage, never()).read(3);
  }
  @Test void unclassifiedPrivateFilesAreNotGrantedByHavingAllSixModules() {
    file("OTHER");
    when(auth.requireAdmin(request)).thenReturn(new AdminPrincipal(2,"member","成员","DEPARTMENT_MEMBER",1L,"部门",false,Set.of(AdminPermission.values())));
    assertThatThrownBy(() -> controller.get(3,request)).isInstanceOf(DomainException.class);
    verify(storage,never()).read(3);
  }
}
