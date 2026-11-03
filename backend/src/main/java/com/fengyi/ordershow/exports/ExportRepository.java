package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class ExportRepository {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final ObjectMapper json;
  private final ExportPolicy policy;
  private final int queueLimit;
  public ExportRepository(JdbcTemplate source, PlatformTransactionManager manager, ObjectMapper json, ExportPolicy policy,
      @Value("${order-show.export.queue-limit:10}") int queueLimit) {
    jdbc = new JdbcTemplate(Objects.requireNonNull(source.getDataSource())); jdbc.setQueryTimeout(10);
    tx = new TransactionTemplate(manager); this.json=json; this.policy=policy; this.queueLimit=Math.clamp(queueLimit,1,100);
  }
  public Task create(long activityId, Filters filters, String key, AdminPrincipal admin) {
    ExportPolicy.requireAdmin(admin);
    if (key == null || !key.matches("[A-Za-z0-9._:-]{8,128}")) throw DomainException.badRequest("EXPORT_REQUEST_KEY_REQUIRED","缺少有效的导出请求编号");
    String encoded=encode(filters), hash=hash(encoded);
    return tx.execute(s -> {
      var activity=policy.requireActivity(activityId,true);
      jdbc.queryForList("SELECT id FROM order_export_worker WHERE id=1 FOR UPDATE");
      var repeated=jdbc.query("SELECT t.* FROM export_task t JOIN order_export_request r ON r.task_id=t.id WHERE r.created_by=? AND r.request_key=?",this::map,admin.id(),key);
      if (!repeated.isEmpty()) {
        Task previous=repeated.getFirst();
        if(previous.activityId()!=activityId || !previous.filters().equals(filters) || previous.generation()!=activity.generation())
          throw DomainException.conflict("EXPORT_REQUEST_CONFLICT","请求编号已用于其他导出，请重新提交");
        return previous;
      }
      var active=jdbc.query("SELECT * FROM export_task WHERE activity_id=? AND export_type='ORDER_PACKAGE' AND filter_hash=? AND activity_generation=? AND cancel_requested=FALSE AND status IN ('PENDING','RUNNING') ORDER BY id DESC LIMIT 1",this::map,activityId,hash,activity.generation());
      if(!active.isEmpty()) {
        Task shared=active.getFirst();remember(admin.id(),key,shared.id());return shared;
      }
      long count=jdbc.queryForObject("SELECT COUNT(*) FROM export_task WHERE export_type='ORDER_PACKAGE' AND status IN ('PENDING','RUNNING')",Long.class);
      if(count>=queueLimit) throw new DomainException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"EXPORT_QUEUE_FULL","导出排队任务较多，请稍后再试");
      jdbc.update("""
          INSERT INTO export_task(activity_id,export_type,filter_json,created_by,request_key,filter_hash,activity_generation)
          VALUES(?,'ORDER_PACKAGE',CAST(? AS JSON),?,?,?,?)
          """,activityId,encoded,admin.id(),key,hash,activity.generation());
      Task created=jdbc.query("SELECT * FROM export_task WHERE created_by=? AND request_key=?",this::map,admin.id(),key).getFirst();
      remember(admin.id(),key,created.id());return created;
    });
  }
  public List<Task> list(long id) { return jdbc.query("SELECT * FROM export_task WHERE activity_id=? AND export_type='ORDER_PACKAGE' ORDER BY id DESC LIMIT 20",this::map,id); }
  public Task task(long activity,long id) {
    var rows=jdbc.query("SELECT * FROM export_task WHERE id=? AND activity_id=? AND export_type='ORDER_PACKAGE'",this::map,id,activity);
    if(rows.isEmpty()) throw DomainException.notFound("EXPORT_TASK_NOT_FOUND","导出任务不存在");
    return rows.getFirst();
  }
  public Claim claim() {
    return tx.execute(s -> {
      var locks=jdbc.queryForList("SELECT * FROM order_export_worker WHERE id=1 FOR UPDATE SKIP LOCKED");
      if(locks.isEmpty()) return null;
      var slot=locks.getFirst();
      if(slot.get("task_id")!=null) {
        boolean live=Boolean.TRUE.equals(jdbc.queryForObject("SELECT lease_expires_at>UTC_TIMESTAMP(3) FROM order_export_worker WHERE id=1",Boolean.class));
        if(live) return null;
        jdbc.update("""
            UPDATE export_task SET status=IF(attempt_count<3 AND cancel_requested=FALSE,'PENDING','FAILED'),
              stage=IF(attempt_count<3 AND cancel_requested=FALSE,'QUEUED','FAILED'),lease_token=NULL,
              failure_code='EXPORT_WORKER_INTERRUPTED',failure_message='后台生成中断，已恢复排队或达到重试上限',updated_at=UTC_TIMESTAMP(3)
            WHERE id=? AND status='RUNNING' AND lease_token=?
            """,slot.get("task_id"),slot.get("lease_token"));
      }
      var tasks=jdbc.query("SELECT * FROM export_task WHERE export_type='ORDER_PACKAGE' AND status='PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",this::map);
      if(tasks.isEmpty()) { jdbc.update("UPDATE order_export_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1"); return null; }
      Task task=tasks.getFirst(); String token=UUID.randomUUID().toString();
      jdbc.update("UPDATE order_export_worker SET task_id=?,lease_token=?,lease_expires_at=TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(3)) WHERE id=1",task.id(),token);
      jdbc.update("UPDATE export_task SET status='RUNNING',stage='READING',lease_token=?,attempt_count=attempt_count+1,started_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3),failure_code=NULL,failure_message=NULL,order_count=0,detail_count=0,result_file_id=NULL WHERE id=?",token,task.id());
      return new Claim(task(task.activityId(),task.id()),token);
    });
  }
  public boolean heartbeat(Claim claim) {
    return jdbc.update("""
        UPDATE order_export_worker w JOIN export_task t ON t.id=w.task_id
        SET w.lease_expires_at=TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(3))
        WHERE w.id=1 AND w.task_id=? AND w.lease_token=? AND t.lease_token=? AND t.status='RUNNING' AND t.cancel_requested=FALSE
          AND w.lease_expires_at>UTC_TIMESTAMP(3)
        """,claim.task().id(),claim.token(),claim.token())==1;
  }
  public void progress(Claim claim,String stage,long orders,long details) {
    if(jdbc.update("UPDATE export_task SET stage=?,order_count=?,detail_count=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=? AND status='RUNNING' AND cancel_requested=FALSE",stage,orders,details,claim.task().id(),claim.token())!=1)
      throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
  }
  public void complete(Claim claim,long file,Result result,int retentionHours) {
    tx.executeWithoutResult(s -> {
      policy.requireActivity(claim.task().activityId(),true); policy.requireTask(claim.task());
      if(!heartbeat(claim))throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
      if(jdbc.update("""
          UPDATE export_task SET status='COMPLETED',stage='COMPLETED',result_file_id=?,row_count=?,order_count=?,detail_count=?,
            sheet_counts_json=CAST(? AS JSON),snapshot_at=?,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3),
            expires_at=TIMESTAMPADD(HOUR,?,UTC_TIMESTAMP(3))
          WHERE id=? AND lease_token=? AND status='RUNNING' AND cancel_requested=FALSE
          """,file,result.counts().get(1),result.counts().get(0),result.counts().get(1),encode(result.counts()),UtcTime.database(result.snapshotAt()),retentionHours,claim.task().id(),claim.token())!=1)
        throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
    });
  }
  public com.fengyi.ordershow.storage.StorageService.FileMeta prepareFile(Claim claim,com.fengyi.ordershow.storage.StorageService storage,
      String filename,long size,byte[] sha) {
    return tx.execute(s -> {
      policy.requireActivity(claim.task().activityId(),true);policy.requireTask(claim.task());
      if(!heartbeat(claim))throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
      var file=storage.prepareExport(claim.task().activityId(),filename,size,sha,claim.task().createdBy(),claim.token());
      jdbc.update("UPDATE export_task SET result_file_id=? WHERE id=? AND lease_token=?",file.id(),claim.task().id(),claim.token());
      return file;
    });
  }
  public void fail(Claim claim,String code,String message) {
    jdbc.update("UPDATE export_task SET status='FAILED',stage='FAILED',failure_code=?,failure_message=?,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=? AND status='RUNNING'",code,message,claim.task().id(),claim.token());
  }
  public void release(Claim claim) {
    // If recording failure failed, keep the slot for lease recovery instead of stranding RUNNING forever.
    jdbc.update("""
        UPDATE order_export_worker w JOIN export_task t ON t.id=w.task_id
        SET w.task_id=NULL,w.lease_token=NULL,w.lease_expires_at=NULL
        WHERE w.id=1 AND w.task_id=? AND w.lease_token=? AND t.status<>'RUNNING'
        """,claim.task().id(),claim.token());
  }
  public void cancel(long activity,long id) {
    jdbc.update("""
        UPDATE export_task SET cancel_requested=TRUE,stage=IF(status='PENDING','FAILED',stage),status=IF(status='PENDING','FAILED',status),
          failure_code='EXPORT_CANCELLED',failure_message='导出已取消',updated_at=UTC_TIMESTAMP(3)
        WHERE activity_id=? AND id=? AND status IN ('PENDING','RUNNING')
        """,activity,id);
  }
  public void expire() { jdbc.update("UPDATE export_task SET status='EXPIRED',stage='EXPIRED' WHERE export_type='ORDER_PACKAGE' AND status='COMPLETED' AND expires_at<=UTC_TIMESTAMP(3)"); }
  public List<Task> expiredFiles() { return jdbc.query("SELECT * FROM export_task WHERE export_type='ORDER_PACKAGE' AND status IN ('EXPIRED','FAILED') AND result_file_id IS NOT NULL LIMIT 10",this::map); }
  public void cleared(Task task) { jdbc.update("UPDATE export_task SET result_file_id=NULL WHERE id=? AND status IN ('EXPIRED','FAILED')",task.id()); }
  public List<Long> orphanedFiles() {
    // A reclaimed attempt can no longer publish. Allow ample time for bounded storage I/O to stop.
    return jdbc.queryForList("""
        SELECT f.id FROM stored_file f LEFT JOIN export_task t ON t.result_file_id=f.id
        WHERE f.file_purpose='EXPORT_RESULT' AND f.deleted_at IS NULL AND t.id IS NULL
          AND f.created_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)) LIMIT 10
        """,Long.class);
  }
  private void remember(long admin,String key,long task) {
    jdbc.update("INSERT INTO order_export_request(created_by,request_key,task_id) VALUES(?,?,?)",admin,key,task);
  }
  private Task map(ResultSet r,int n)throws SQLException {
    try {
      Long file=r.getObject("result_file_id")==null?null:r.getLong("result_file_id");
      return new Task(r.getLong("id"),r.getLong("activity_id"),r.getString("status"),r.getString("stage"),
          json.readValue(r.getString("filter_json"),Filters.class),r.getLong("order_count"),r.getLong("detail_count"),
          r.getString("sheet_counts_json")==null?List.of():json.readValue(r.getString("sheet_counts_json"),new TypeReference<List<Long>>(){}),
          UtcTime.read(r,"snapshot_at"),UtcTime.read(r,"created_at"),UtcTime.read(r,"completed_at"),UtcTime.read(r,"expires_at"),
          r.getString("failure_code"),r.getString("failure_message"),file,r.getLong("activity_generation"),r.getLong("created_by"),r.getString("lease_token"),r.getBoolean("cancel_requested"));
    }catch(java.io.IOException error){throw new IllegalStateException("导出任务记录无法读取",error);}
  }
  private String encode(Object value) { try{return json.writeValueAsString(value);}catch(Exception error){throw new IllegalStateException(error);} }
  private static String hash(String value) { try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException(error);} }
}
