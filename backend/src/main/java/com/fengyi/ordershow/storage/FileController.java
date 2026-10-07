package com.fengyi.ordershow.storage;

import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/public/files")
public class FileController {
  private final StorageService storage;

  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final com.fengyi.ordershow.security.AuthService auth;
  private final com.fengyi.ordershow.security.DepartmentAccessService access;
  public FileController(StorageService storage, org.springframework.jdbc.core.JdbcTemplate jdbc,
      com.fengyi.ordershow.security.AuthService auth, com.fengyi.ordershow.security.DepartmentAccessService access) {
    this.storage = storage; this.jdbc = jdbc; this.auth = auth; this.access = access;
  }

  @GetMapping("/{fileId}")
  ResponseEntity<byte[]> get(@PathVariable long fileId, jakarta.servlet.http.HttpServletRequest request) {
    var files = jdbc.queryForList("SELECT activity_id,file_purpose FROM stored_file WHERE id=? AND deleted_at IS NULL", fileId);
    if (files.isEmpty()) throw com.fengyi.ordershow.common.DomainException.notFound("FILE_NOT_FOUND", "文件不存在");
    var file = files.getFirst();
    String purpose = file.get("file_purpose").toString();
    // Product/prize images remain public assets used by H5 and screens. Source sheets are private.
    if (!java.util.List.of("PRODUCT_IMAGE", "LOTTERY_PRIZE_IMAGE").contains(purpose)) {
      var admin = auth.requireAdmin(request);
      long activityId = ((Number)file.get("activity_id")).longValue();
      access.requireActivityAccess(admin, activityId);
      if (admin.isMember()) {
        var types = jdbc.queryForList("SELECT import_type FROM import_task WHERE activity_id=? AND (source_file_id=? OR auxiliary_file_id=?)", String.class, activityId, fileId, fileId);
        if (types.isEmpty()) admin.requireManager();
        else for (String type : types) admin.requirePermission(com.fengyi.ordershow.security.MemberPermissionService.importPermission(type));
      }
    }
    StorageService.FileMeta meta = storage.meta(fileId);
    MediaType contentType;
    try { contentType = MediaType.parseMediaType(meta.contentType()); }
    catch (Exception ignored) { contentType = MediaType.APPLICATION_OCTET_STREAM; }
    return ResponseEntity.ok().contentType(contentType).contentLength(meta.sizeBytes())
        .cacheControl(CacheControl.noCache())
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(meta.filename()).build().toString())
        .body(storage.read(fileId));
  }
}
