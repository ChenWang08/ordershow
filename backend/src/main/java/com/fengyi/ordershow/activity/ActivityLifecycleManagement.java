package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityLifecycleManagement {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final DepartmentAccessService access;
  private final DashboardService dashboards;
  private final int maxRetries;

  public ActivityLifecycleManagement(JdbcTemplate jdbc, ActivityService activities,
      DepartmentAccessService access, DashboardService dashboards,
      @org.springframework.beans.factory.annotation.Value("${order-show.activity-deletion.max-retries:5}") int maxRetries) {
    this.jdbc=new JdbcTemplate(java.util.Objects.requireNonNull(jdbc.getDataSource()));
    this.jdbc.setQueryTimeout(15);
    this.activities=activities; this.access=access; this.dashboards=dashboards; this.maxRetries=Math.clamp(maxRetries,1,20);
  }

  @Transactional
  public ActivityService.ActivityView archive(long id, int version, String reason, AdminPrincipal admin) {
    access.requireSuperAdmin(admin); requireReason(reason); lock(id);
    var current=activities.byId(id); requireVersion(current.version(),version);
    if (!"FINISHED".equals(current.status())) throw DomainException.conflict("ACTIVITY_ARCHIVE_INVALID", "只有已结束活动可以归档");
    requireSettled(id);
    dashboards.refreshFinalSnapshots(id);
    jdbc.update("UPDATE activity SET status='ARCHIVED',archived_at=UTC_TIMESTAMP(3),version=version+1,updated_by=? WHERE id=?",admin.id(),id);
    ActivityInfoChanges.record(jdbc,id);
    audit(id,admin,"ACTIVITY_ARCHIVE",reason);
    return activities.byId(id);
  }

  @Transactional
  public ActivityService.ActivityView unarchive(long id, int version, String reason, AdminPrincipal admin) {
    access.requireSuperAdmin(admin); requireReason(reason); lock(id);
    var current=activities.byId(id); requireVersion(current.version(),version);
    if (!"ARCHIVED".equals(current.status())) throw DomainException.conflict("ACTIVITY_UNARCHIVE_INVALID", "只有已归档活动可以解除归档");
    jdbc.update("UPDATE activity SET status='FINISHED',archived_at=NULL,finished_at=COALESCE(finished_at,UTC_TIMESTAMP(3)),version=version+1,updated_by=? WHERE id=?",admin.id(),id);
    ActivityInfoChanges.record(jdbc,id);
    audit(id,admin,"ACTIVITY_UNARCHIVE",reason);
    return activities.byId(id);
  }

  public DeletionPreview preview(long id, AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    var a=activities.byId(id);
    requireDeletable(a.status());
    return new DeletionPreview(a.id(),a.code(),a.name(),a.departmentName(),a.version(),count("customer_order",id),
        count("activity_product",id),count("activity_customer",id),count("lottery_winner",id),count("stored_file",id));
  }

  @Transactional
  public DeletionTask delete(long id,int version,String code,String reason,AdminPrincipal admin) {
    access.requireSuperAdmin(admin); requireReason(reason);
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE",Long.class,id);
    var existing=jdbc.query("SELECT * FROM activity_deletion_task WHERE activity_id=?",this::mapConfiguredTask,id);
    if (!existing.isEmpty()) {
      if (!existing.getFirst().activityCode().equals(code)) throw DomainException.badRequest("ACTIVITY_CODE_MISMATCH","请输入正确的活动编号");
      return existing.getFirst();
    }
    var a=activities.byId(id); requireVersion(a.version(),version); requireDeletable(a.status());
    if (!a.code().equals(code)) throw DomainException.badRequest("ACTIVITY_CODE_MISMATCH","请输入正确的活动编号");
    requireSettled(id);
    jdbc.update("""
        INSERT INTO activity_deletion_task(activity_id,activity_code,activity_name,department_id,department_name,requested_by,requested_by_name,reason)
        VALUES(?,?,?,?,?,?,?,?)
        """,id,a.code(),a.name(),a.departmentId(),a.departmentName(),admin.id(),admin.displayName(),reason.trim());
    jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3),version=version+1,public_info_version=public_info_version+1 WHERE id=?",id);
    jdbc.update("UPDATE h5_session SET revoked_at=UTC_TIMESTAMP(3) WHERE activity_id=? AND revoked_at IS NULL",id);
    audit(null,admin,"ACTIVITY_DELETE_REQUESTED",a.code()+"："+reason);
    return jdbc.query("SELECT * FROM activity_deletion_task WHERE activity_id=?",this::mapConfiguredTask,id).getFirst();
  }

  public List<DeletionTask> tasks(AdminPrincipal admin,int page) {
    access.requireSuperAdmin(admin);
    return jdbc.query("SELECT * FROM activity_deletion_task ORDER BY id DESC LIMIT 20 OFFSET ?",this::mapConfiguredTask,(Math.max(1L,page)-1)*20);
  }

  @Transactional
  public DeletionTask retry(long taskId,AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    var task=lockTask(taskId);
    if(!"FAILED".equals(task.status())) throw DomainException.conflict("DELETION_RETRY_INVALID","只有失败任务可以重试");
    jdbc.update("UPDATE activity_deletion_task SET status='QUEUED',retry_count=0,last_error=NULL,next_attempt_at=UTC_TIMESTAMP(3),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",taskId);
    audit(null,admin,"ACTIVITY_DELETE_RETRY",task.activityCode());
    return readTask(taskId);
  }

  @Transactional
  public DeletionTask pause(long taskId,AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    // The worker holds this row for the whole batch: pause takes effect after that batch commits.
    var task=lockTask(taskId);
    if("PAUSED".equals(task.status())) return task;
    if(!List.of("QUEUED","RUNNING").contains(task.status())) throw DomainException.conflict("DELETION_PAUSE_INVALID","只有排队或清理中的任务可以暂停");
    jdbc.update("UPDATE activity_deletion_task SET status='PAUSED',revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",taskId);
    audit(null,admin,"ACTIVITY_DELETE_PAUSE",task.activityCode());
    return readTask(taskId);
  }

  @Transactional
  public DeletionTask resume(long taskId,AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    var task=lockTask(taskId);
    if(!"PAUSED".equals(task.status())) throw DomainException.conflict("DELETION_RESUME_INVALID","只有已暂停任务可以继续");
    jdbc.update("UPDATE activity_deletion_task SET status='QUEUED',retry_count=0,last_error=NULL,next_attempt_at=UTC_TIMESTAMP(3),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",taskId);
    audit(null,admin,"ACTIVITY_DELETE_RESUME",task.activityCode());
    return readTask(taskId);
  }

  private DeletionTask lockTask(long taskId) {
    var rows=jdbc.query("SELECT * FROM activity_deletion_task WHERE id=? FOR UPDATE",this::mapConfiguredTask,taskId);
    if(rows.isEmpty()) throw DomainException.notFound("DELETION_TASK_NOT_FOUND","删除任务不存在");
    return rows.getFirst();
  }
  private DeletionTask readTask(long taskId){return jdbc.query("SELECT * FROM activity_deletion_task WHERE id=?",this::mapConfiguredTask,taskId).getFirst();}
  private DeletionTask mapConfiguredTask(java.sql.ResultSet r,int n)throws java.sql.SQLException{return mapTask(r,n,maxRetries);}

  private void lock(long id) {
    if(jdbc.queryForList("SELECT id FROM activity WHERE id=? AND deletion_requested_at IS NULL FOR UPDATE",Long.class,id).isEmpty()) throw ActivityAccessPolicy.missing();
  }
  private long count(String table,long id) { return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE activity_id=?",Long.class,id); }
  private void requireSettled(long id) {
    if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM activity_copy_task WHERE source_activity_id=? AND status IN ('QUEUED','RUNNING'))",Boolean.class,id)))
      throw DomainException.conflict("ACTIVITY_COPY_IN_PROGRESS","活动配置正在被复用，请等待复制完成后再归档或删除");
    if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM order_change_request WHERE activity_id=? AND status='PENDING')",Boolean.class,id))
        ||Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM import_task WHERE activity_id=? AND status NOT IN ('COMPLETED','FAILED','CANCELLED'))",Boolean.class,id))
        ||Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM export_task WHERE activity_id=? AND status IN ('PENDING','RUNNING'))",Boolean.class,id)))
      throw DomainException.conflict("ACTIVITY_UNSETTLED_TASKS","请先完成或取消待审批改单及未完成的导入、导出任务");
  }
  private static void requireDeletable(String status) {
    if(!List.of("DRAFT","FINISHED","ARCHIVED").contains(status)) throw DomainException.conflict("ACTIVITY_DELETE_INVALID","只有草稿、已结束、已归档活动可以永久删除");
  }
  private static void requireVersion(int actual,int expected) {
    if(actual!=expected) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT","活动已变化，请刷新后重试");
  }
  private static void requireReason(String reason) {
    if(reason==null||reason.isBlank()||reason.trim().length()>500) throw DomainException.badRequest("ACTIVITY_REASON_REQUIRED","请填写操作原因（最多500字）");
  }
  private void audit(Long id,AdminPrincipal admin,String action,String reason) {
    jdbc.update("""
        INSERT INTO audit_log(activity_id,actor_type,admin_user_id,actor_identity_snapshot,actor_role_snapshot,action_code,object_type,object_id,reason,result,trace_id,occurred_at)
        VALUES(?,'ADMIN',?,?,?,?,'ACTIVITY',?,?,'SUCCESS',?,UTC_TIMESTAMP(3))
        """,id,admin.id(),admin.displayName(),admin.roleCode(),action,id==null?null:Long.toString(id),reason.substring(0,Math.min(500,reason.length())),java.util.UUID.randomUUID().toString());
  }
  static DeletionTask mapTask(java.sql.ResultSet r,int n)throws java.sql.SQLException {
    return mapTask(r,n,5);
  }
  private static DeletionTask mapTask(java.sql.ResultSet r,int n,int maxRetries)throws java.sql.SQLException {
    return new DeletionTask(r.getLong("id"),r.getLong("activity_id"),r.getString("activity_code"),r.getString("activity_name"),r.getString("department_name"),
        r.getString("requested_by_name"),r.getString("reason"),r.getString("status"),r.getInt("stage"),r.getLong("deleted_rows"),r.getLong("deleted_files"),r.getString("last_error"),
        UtcTime.read(r,"created_at"),UtcTime.read(r,"updated_at"),UtcTime.read(r,"completed_at"),ActivityDeletionWorker.stageName(r.getInt("stage")),
        r.getInt("retry_count"),maxRetries,UtcTime.read(r,"next_attempt_at"),UtcTime.read(r,"last_progress_at"),ActivityDeletionWorker.stageDetail(r.getInt("stage")),ActivityDeletionWorker.FINISH);
  }
  public record DeletionPreview(long activityId,String code,String name,String departmentName,int version,long orders,long products,long customers,long winners,long files) {}
  public record DeletionTask(long id,long activityId,String activityCode,String activityName,String departmentName,String requestedByName,String reason,String status,int stage,long deletedRows,long deletedFiles,String lastError,Instant createdAt,Instant updatedAt,Instant completedAt,String stageName,int retryCount,int maxRetries,Instant nextAttemptAt,Instant lastProgressAt,String stageDetail,int totalStages) {}
}
