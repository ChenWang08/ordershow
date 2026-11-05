package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Shared by the HTTP boundary and lifecycle commands. Never treats archive as deletion. */
@Service
public class ActivityAccessPolicy {
  private final JdbcTemplate jdbc;
  public ActivityAccessPolicy(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public void readable(long id) { row(id); }

  public long readableCode(String code) {
    var ids = jdbc.queryForList("SELECT id FROM activity WHERE activity_code=? AND deletion_requested_at IS NULL AND configuration_state='READY'", Long.class, code);
    if (ids.isEmpty()) throw missing();
    return ids.getFirst();
  }

  public void readableFile(long id) {
    var rows = jdbc.queryForList("""
        SELECT f.id FROM stored_file f LEFT JOIN activity a ON a.id=f.activity_id
        WHERE f.id=? AND f.deleted_at IS NULL
          AND (f.activity_id IS NULL OR (a.id IS NOT NULL AND a.deletion_requested_at IS NULL AND a.configuration_state='READY'))
        """, Long.class, id);
    if (rows.isEmpty()) throw DomainException.notFound("FILE_NOT_FOUND", "文件不存在或所属活动已删除");
  }

  public void lockWrite(long id, boolean lifecycle, boolean allowArchiveRead, boolean repeatedDelete, boolean shared) {
    var rows = jdbc.queryForList("SELECT status,deletion_requested_at,configuration_state FROM activity WHERE id=? " + (shared ? "FOR SHARE" : "FOR UPDATE"), id);
    if (rows.isEmpty()) {
      if (repeatedDelete && Boolean.TRUE.equals(jdbc.queryForObject(
          "SELECT EXISTS(SELECT 1 FROM activity_deletion_task WHERE activity_id=?)", Boolean.class, id))) return;
      throw missing();
    }
    var row = rows.getFirst();
    if (!"READY".equals(row.get("configuration_state"))) throw missing();
    if (row.get("deletion_requested_at") != null && !repeatedDelete) throw missing();
    if ("ARCHIVED".equals(row.get("status")) && !lifecycle && !allowArchiveRead)
      throw DomainException.conflict("ACTIVITY_ARCHIVED_READ_ONLY", "活动已归档，请先由超级管理员解除归档");
  }

  private void row(long id) {
    if (!Boolean.TRUE.equals(jdbc.queryForObject(
        "SELECT EXISTS(SELECT 1 FROM activity WHERE id=? AND deletion_requested_at IS NULL AND configuration_state='READY')", Boolean.class, id))) throw missing();
  }
  static DomainException missing() { return DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在或已删除"); }
}
