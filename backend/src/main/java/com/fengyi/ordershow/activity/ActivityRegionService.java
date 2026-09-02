package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ActivityRegionService {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;

  public ActivityRegionService(JdbcTemplate jdbc, CryptoService crypto) {
    this.jdbc = jdbc;
    this.crypto = crypto;
  }

  /**
   * Resolves an admin-entered region name or an existing region code to the activity's canonical code.
   * The whitelist is the source of truth. This table only keeps a stable code/name dictionary so H5,
   * orders and historical reports can continue to refer to the same region after later edits.
   */
  public String resolveCode(long activityId, String nameOrCode) {
    if (nameOrCode == null || nameOrCode.isBlank()) return null;
    String value = nameOrCode.trim();
    List<String> existing = jdbc.queryForList("""
        SELECT region_code FROM activity_region
        WHERE activity_id = ? AND (region_code = ? OR region_name = ?)
        ORDER BY CASE WHEN region_code = ? THEN 0 ELSE 1 END, id
        """, String.class, activityId, value, value, value);
    if (!existing.isEmpty()) {
      jdbc.update("UPDATE activity_region SET is_active = TRUE WHERE activity_id = ? AND region_code = ?",
          activityId, existing.getFirst());
      return existing.getFirst();
    }

    String generatedCode = "R_" + HexFormat.of().formatHex(crypto.sha256(value))
        .substring(0, 12).toUpperCase(Locale.ROOT);
    jdbc.update("""
        INSERT INTO activity_region(activity_id, region_code, region_name, sort_no, is_active)
        SELECT ?, ?, ?, COALESCE(MAX(sort_no), 0) + 10, TRUE FROM activity_region WHERE activity_id = ?
        ON DUPLICATE KEY UPDATE is_active = TRUE
        """, activityId, generatedCode, value, activityId);
    List<String> resolved = jdbc.queryForList("""
        SELECT region_code FROM activity_region
        WHERE activity_id = ? AND region_name = ?
        """, String.class, activityId, value);
    if (resolved.isEmpty()) {
      throw DomainException.conflict("ACTIVITY_REGION_SYNC_FAILED", "大区名称与现有活动配置冲突，请刷新后重试");
    }
    return resolved.getFirst();
  }
}
