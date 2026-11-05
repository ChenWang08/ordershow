package com.fengyi.ordershow.exports;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ExportPolicy {
  private final JdbcTemplate jdbc;
  public ExportPolicy(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  public static void requireAdmin(AdminPrincipal admin) {
    if (admin == null || !admin.isSuperAdmin()) throw DomainException.forbidden("SUPER_ADMIN_REQUIRED","仅系统管理员可导出订单");
  }
  public ExportModels.Activity requireActivity(long id, boolean lock) {
    var rows = jdbc.queryForList("""
        SELECT id,name,export_generation,status,event_ends_at,
          (status IN ('FINISHED','ARCHIVED') OR (status <> 'DRAFT' AND event_ends_at <= UTC_TIMESTAMP(3))) ended
        FROM activity WHERE id=? AND deletion_requested_at IS NULL
        """ + (lock ? " FOR SHARE" : ""), id);
    if (rows.isEmpty()) throw DomainException.notFound("ACTIVITY_NOT_FOUND","活动不存在或已删除");
    var row = rows.getFirst();
    if (!Boolean.TRUE.equals(row.get("ended")) && !"1".equals(String.valueOf(row.get("ended"))))
      throw DomainException.conflict("EXPORT_ACTIVITY_NOT_FINISHED","整场活动结束后才可导出订单");
    return new ExportModels.Activity(id,row.get("name").toString(),((Number)row.get("export_generation")).longValue());
  }
  public void requireTask(ExportModels.Task task) {
    if (requireActivity(task.activityId(),false).generation() != task.generation())
      throw DomainException.conflict("EXPORT_ACTIVITY_REOPENED","活动曾重新开放，请在整场活动结束后重新生成");
  }
  public void requireCreator(long id) {
    if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM admin_user WHERE id=? AND role_code='SUPER_ADMIN' AND status='ACTIVE')",Boolean.class,id)))
      throw DomainException.forbidden("EXPORT_CREATOR_UNAVAILABLE","任务创建人的管理员权限已失效");
  }
}
