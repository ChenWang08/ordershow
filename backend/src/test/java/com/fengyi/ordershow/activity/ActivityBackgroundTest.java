package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.storage.StorageService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;

class ActivityBackgroundTest {
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final StorageService storage = mock(StorageService.class);
  final DepartmentAccessService access = mock(DepartmentAccessService.class);
  final ActivityService activities = mock(ActivityService.class);
  final ActivityBackgroundService service = new ActivityBackgroundService(jdbc, storage, access, activities);
  final AdminPrincipal admin = new AdminPrincipal(8, "admin", "Admin", "DEPARTMENT_ADMIN", 2L, "D", false);

  MockMultipartFile jpeg(int size) {
    byte[] bytes = new byte[size];
    if (size >= 4) { bytes[0] = (byte)255; bytes[1] = (byte)216; bytes[2] = (byte)255; }
    return new MockMultipartFile("file", "background.JPG", "application/octet-stream", bytes);
  }

  @Test void enforcesSeparateLimitsAndRejectsDisguisedFiles() {
    assertThat(ActivityBackgroundService.validate(jpeg(5 * 1024 * 1024), "h5")).isEqualTo("image/jpeg");
    assertThat(ActivityBackgroundService.validate(jpeg(10 * 1024 * 1024), "desktop")).isEqualTo("image/jpeg");
    assertThatThrownBy(() -> ActivityBackgroundService.validate(jpeg(5 * 1024 * 1024 + 1), "h5")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> ActivityBackgroundService.validate(jpeg(10 * 1024 * 1024 + 1), "desktop")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> ActivityBackgroundService.validate(jpeg(0), "h5")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> ActivityBackgroundService.validate(new MockMultipartFile("file", "image.png", "image/png", "<svg/>".getBytes()), "h5")).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> ActivityBackgroundService.validate(new MockMultipartFile("file", "image.svg", "image/svg+xml", "<svg/>".getBytes()), "h5")).isInstanceOf(DomainException.class);
  }

  @Test void acceptsPngAndWebpSignaturesWithCanonicalContentTypes() {
    byte[] png = java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=");
    assertThat(ActivityBackgroundService.validate(new MockMultipartFile("file", "x.png", "text/plain", png), "h5")).isEqualTo("image/png");
    byte[] webp = java.util.Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
    assertThat(ActivityBackgroundService.validate(new MockMultipartFile("file", "x.webp", "text/plain", webp), "desktop")).isEqualTo("image/webp");
  }

  @Test void resetChangesOnlyTheSelectedActivityAndKind() {
    when(jdbc.queryForList(anyString(), eq(42L))).thenReturn(List.of(Map.of("desktop_background_file_id", 99L)));
    service.update(42, "desktop", null, admin);
    verify(access).requireActivityAccess(admin, 42);
    verify(jdbc).update("UPDATE activity SET desktop_background_file_id = ?, updated_by = ? WHERE id = ?", null, 8L, 42L);
    verify(jdbc).update(contains("file_purpose = 'ACTIVITY_BACKGROUND'"), eq(99L), eq(42L));
    verifyNoInteractions(storage);
  }

  @Test void uploadPersistsCanonicalTypeAndActivityAssociation() throws Exception {
    when(jdbc.queryForList(anyString(), eq(42L))).thenReturn(List.of(Map.of()));
    when(storage.save(eq(42L), eq("background.JPG"), eq("image/jpeg"), any(byte[].class), eq("ACTIVITY_BACKGROUND"), eq(8L)))
        .thenReturn(new StorageService.StoredFile(101, 42, "key", "background.JPG", "image/jpeg", 32, new byte[0]));
    service.update(42, "h5", jpeg(32), admin);
    verify(jdbc).update("UPDATE activity SET h5_background_file_id = ?, updated_by = ? WHERE id = ?", 101L, 8L, 42L);
    verify(activities).byId(42);
  }

  @Test void permissionChecksPrecedeStorageAndMutation() {
    var member = new AdminPrincipal(9, "member", "Member", "DEPARTMENT_MEMBER", 2L, "D", false);
    assertThatThrownBy(() -> service.update(42, "h5", jpeg(32), member)).isInstanceOf(DomainException.class);
    doThrow(DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在")).when(access).requireActivityAccess(admin, 43);
    assertThatThrownBy(() -> service.update(43, "h5", jpeg(32), admin)).isInstanceOf(DomainException.class);
    verifyNoInteractions(jdbc, storage);
  }
}
