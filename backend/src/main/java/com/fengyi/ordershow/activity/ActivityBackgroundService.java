package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.storage.StorageService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ActivityBackgroundService {
  private final JdbcTemplate jdbc;
  private final StorageService storage;
  private final DepartmentAccessService access;
  private final ActivityService activities;

  public ActivityBackgroundService(JdbcTemplate jdbc, StorageService storage,
      DepartmentAccessService access, ActivityService activities) {
    this.jdbc = jdbc; this.storage = storage; this.access = access; this.activities = activities;
  }

  @Transactional
  public ActivityService.ActivityView update(long activityId, String kind, MultipartFile file, AdminPrincipal admin) {
    admin.requireManager();
    access.requireActivityAccess(admin, activityId);
    String column = switch (kind) {
      case "h5" -> "h5_background_file_id";
      case "desktop" -> "desktop_background_file_id";
      default -> throw DomainException.badRequest("BACKGROUND_KIND_INVALID", "背景类型无效");
    };
    // Serialize changes to one activity without overwriting its other settings.
    var rows = jdbc.queryForList("SELECT " + column + " FROM activity WHERE id = ? AND archived_at IS NULL FOR UPDATE", activityId);
    if (rows.isEmpty()) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    Long previousId = rows.getFirst().get(column) instanceof Number n ? n.longValue() : null;
    Long fileId = null;
    if (file != null) {
      byte[] bytes;
      String contentType = validate(file, kind);
      try {
        bytes = file.getBytes();
        fileId = storage.save(activityId, file.getOriginalFilename(), contentType, bytes, "ACTIVITY_BACKGROUND", admin.id()).id();
      } catch (DomainException error) { throw error; }
      catch (Exception error) {
        throw new DomainException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_WRITE_FAILED", "背景保存失败，请稍后重试");
      }
    }
    jdbc.update("UPDATE activity SET " + column + " = ?, updated_by = ? WHERE id = ?", fileId, admin.id(), activityId);
    if (previousId != null) {
      jdbc.update("""
          UPDATE stored_file SET deleted_at = UTC_TIMESTAMP(3), reference_count = 0
          WHERE id = ? AND activity_id = ? AND file_purpose = 'ACTIVITY_BACKGROUND'
          """, previousId, activityId);
    }
    return activities.byId(activityId);
  }

  static String validate(MultipartFile file, String kind) {
    long limit = ("h5".equals(kind) ? 5L : 10L) * 1024 * 1024;
    if (file.isEmpty()) throw DomainException.badRequest("BACKGROUND_REQUIRED", "请选择背景图片");
    if (file.getSize() > limit) throw DomainException.badRequest("BACKGROUND_TOO_LARGE", "背景图片不能超过 " + (limit / 1024 / 1024) + "MB");
    String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase(Locale.ROOT);
    try (var stream = file.getInputStream()) {
      byte[] header = stream.readNBytes(32);
      if (header.length >= 24 && name.endsWith(".png")
          && java.util.Arrays.equals(java.util.Arrays.copyOf(header, 8), new byte[]{(byte)137,80,78,71,13,10,26,10})
          && new String(header, 12, 4, StandardCharsets.US_ASCII).equals("IHDR")) return "image/png";
      if (header.length >= 4 && (name.endsWith(".jpg") || name.endsWith(".jpeg"))
          && (header[0] & 255) == 255 && (header[1] & 255) == 216 && (header[2] & 255) == 255) return "image/jpeg";
      if (header.length >= 20 && name.endsWith(".webp")
          && new String(header, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
          && new String(header, 8, 4, StandardCharsets.US_ASCII).equals("WEBP")
          && java.util.Set.of("VP8 ", "VP8L", "VP8X").contains(new String(header, 12, 4, StandardCharsets.US_ASCII))) return "image/webp";
    } catch (IOException error) {
      throw DomainException.badRequest("BACKGROUND_UNREADABLE", "图片无法读取，请重新选择");
    }
    throw DomainException.badRequest("BACKGROUND_TYPE_INVALID", "仅支持有效的 JPG、PNG、WebP 图片");
  }
}
