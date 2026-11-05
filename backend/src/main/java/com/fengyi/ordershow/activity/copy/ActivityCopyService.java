package com.fengyi.ordershow.activity.copy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityCopyService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final DepartmentAccessService access;
  private final ObjectMapper json;
  private final int maxRows,maxBytes,queueLimit;
  public ActivityCopyService(JdbcTemplate jdbc,ActivityService activities,DepartmentAccessService access,ObjectMapper json,
      @Value("${order-show.activity-copy.max-rows:20000}") int rows,
      @Value("${order-show.activity-copy.max-snapshot-bytes:8388608}") int bytes,
      @Value("${order-show.activity-copy.queue-limit:10}") int queue){
    this.jdbc=new JdbcTemplate(Objects.requireNonNull(jdbc.getDataSource()));this.jdbc.setQueryTimeout(5);
    this.activities=activities;this.access=access;this.json=json;
    maxRows=Math.clamp(rows,100,50000);maxBytes=Math.clamp(bytes,1048576,16777216);queueLimit=Math.clamp(queue,1,20);
  }
  public record Preview(long sourceId,String sourceName,String stamp,int products,int customers,int rounds,Long productVersion,Long whitelistVersion,Long ruleId){}
  public record Request(ActivityService.ActivityWrite activity,long sourceId,String sourceStamp,CopySnapshot.Selection selection,String requestKey){}
  public record Task(long id,String status,String stage,int copiedFiles,int totalFiles,String failureMessage,Long activityId,String activityCode){}
  public record Source(long id,String code,String name,String status){}
  public List<Source> sources(long department,AdminPrincipal admin){
    admin.requireManager();access.requireDepartmentAccess(admin,department);
    return jdbc.query("SELECT id,activity_code,name,status FROM activity WHERE department_id=? AND configuration_state='READY' AND deletion_requested_at IS NULL ORDER BY created_at DESC,id DESC",
        (r,n)->new Source(r.getLong(1),r.getString(2),r.getString(3),r.getString(4)),department);
  }

  public Preview preview(long source,long department,AdminPrincipal admin){
    admin.requireManager();access.requireDepartmentAccess(admin,department);access.requireActivityAccess(admin,source);
    var rows=jdbc.queryForList("SELECT name,department_id,version,product_catalog_version FROM activity WHERE id=? AND configuration_state='READY' AND deletion_requested_at IS NULL",source);
    if(rows.isEmpty())throw missing();var row=rows.getFirst();
    if(CopySnapshot.number(row.get("department_id"))!=department)throw DomainException.forbidden("COPY_DEPARTMENT_MISMATCH","只能复用同部门活动的配置");
    var bindings=jdbc.queryForList("SELECT data_type,current_version_id,lock_version FROM activity_data_binding WHERE activity_id=? ORDER BY data_type",source);
    Long product=null,whitelist=null;
    for(var b:bindings){if("PRODUCT".equals(b.get("data_type")))product=CopySnapshot.number(b.get("current_version_id"));if("WHITELIST".equals(b.get("data_type")))whitelist=CopySnapshot.number(b.get("current_version_id"));}
    var rules=jdbc.queryForList("SELECT id,revision FROM lottery_rule WHERE activity_id=? AND status IN ('PUBLISHED','DRAFT') ORDER BY CASE WHEN status='PUBLISHED' THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT 1",source);
    Long rule=rules.isEmpty()?null:CopySnapshot.number(rules.getFirst().get("id"));
    int products=product==null?0:jdbc.queryForObject("SELECT COUNT(*) FROM activity_product WHERE activity_id=? AND data_version_id=? AND data_status<>'INACTIVE' AND deactivated_at IS NULL",Integer.class,source,product);
    int customers=whitelist==null?0:jdbc.queryForObject("SELECT COUNT(*) FROM activity_customer WHERE activity_id=? AND data_version_id=? AND is_active=TRUE",Integer.class,source,whitelist);
    int rounds=rule==null?0:jdbc.queryForObject("SELECT COUNT(*) FROM lottery_round WHERE activity_id=? AND lottery_rule_id=?",Integer.class,source,rule);
    String stamp=hash(encode(List.of(row,bindings,rules)));
    return new Preview(source,row.get("name").toString(),stamp,products,customers,rounds,product,whitelist,rule);
  }

  @Transactional(isolation=Isolation.READ_COMMITTED,timeout=15)
  public Task enqueue(Request request,AdminPrincipal admin){
    admin.requireManager();
    if(request.selection()==null||!request.selection().any())throw DomainException.badRequest("COPY_SELECTION_REQUIRED","请至少选择一项复制内容");
    if(request.requestKey()==null||!request.requestKey().matches("[A-Za-z0-9_-]{8,64}"))throw DomainException.badRequest("COPY_REQUEST_KEY_REQUIRED","缺少有效的创建请求编号");
    String input=hash(encode(List.of(request.activity(),request.sourceId(),Objects.toString(request.sourceStamp(),""),request.selection())));
    jdbc.queryForList("SELECT id FROM activity_copy_worker WHERE id=1 FOR UPDATE");
    var previous=jdbc.queryForList("SELECT id,input_hash FROM activity_copy_task WHERE created_by=? AND request_key=?",admin.id(),request.requestKey());
    if(!previous.isEmpty()){
      if(!input.equals(previous.getFirst().get("input_hash")))throw DomainException.conflict("COPY_REQUEST_CHANGED","此请求已经提交，请等待结果或重新创建");
      return task(CopySnapshot.number(previous.getFirst().get("id")),admin);
    }
    if(jdbc.queryForObject("SELECT COUNT(*) FROM activity_copy_task WHERE status IN ('QUEUED','RUNNING')",Integer.class)>=queueLimit)
      throw DomainException.conflict("COPY_QUEUE_FULL","配置复用任务较多，请稍后再试");
    long department=access.requireDepartmentForCreate(admin,request.activity().departmentId());
    // Short source lock gives a consistent configuration snapshot and serializes deletion. No object I/O here.
    if(jdbc.queryForList("SELECT id FROM activity WHERE id=? AND deletion_requested_at IS NULL AND configuration_state='READY' FOR SHARE",Long.class,request.sourceId()).isEmpty())throw missing();
    Preview preview=preview(request.sourceId(),department,admin);
    if(!preview.stamp().equals(request.sourceStamp()))throw DomainException.conflict("COPY_SOURCE_CHANGED","来源配置已变化，请重新选择来源活动后创建");
    var selection=request.selection();
    if((selection.products()&&preview.products()==0)||(selection.whitelist()&&preview.customers()==0)||(selection.lottery()&&preview.rounds()==0))
      throw DomainException.badRequest("COPY_CONFIGURATION_EMPTY","所选复制内容暂无配置，请重新选择");
    var snapshot=new CopySnapshot(jdbc,json,maxRows,maxBytes).capture(request.sourceId(),preview.productVersion(),preview.whitelistVersion(),preview.ruleId(),selection);
    var target=activities.create(request.activity(),admin);
    jdbc.update("UPDATE activity SET configuration_state='COPYING' WHERE id=?",target.id());
    long id=insert("INSERT INTO activity_copy_task(source_activity_id,target_activity_id,department_id,created_by,request_key,input_hash,snapshot_json,total_files) VALUES(?,?,?,?,?,?,?,?)",
        request.sourceId(),target.id(),department,admin.id(),request.requestKey(),input,encode(snapshot),snapshot.tables().get("files").size());
    jdbc.batchUpdate("INSERT INTO activity_copy_file(task_id,source_file_id) VALUES(?,?)",snapshot.tables().get("files"),200,(ps,file)->{ps.setLong(1,id);ps.setLong(2,CopySnapshot.number(file.get("id")));});
    return task(id,admin);
  }
  public Task task(long id,AdminPrincipal admin){
    admin.requireManager();
    var rows=jdbc.queryForList("SELECT t.*,a.activity_code FROM activity_copy_task t LEFT JOIN activity a ON a.id=t.target_activity_id AND a.deletion_requested_at IS NULL AND a.configuration_state='READY' WHERE t.id=?",id);
    if(rows.isEmpty())throw missing();var r=rows.getFirst();
    access.requireDepartmentAccess(admin,CopySnapshot.number(r.get("department_id")));
    // Another department manager can recover work, but ordinary members never receive snapshot or task data.
    return new Task(id,r.get("status").toString(),r.get("stage").toString(),((Number)r.get("copied_files")).intValue(),((Number)r.get("total_files")).intValue(),(String)r.get("failure_message"),
        r.get("target_activity_id")==null?null:CopySnapshot.number(r.get("target_activity_id")),(String)r.get("activity_code"));
  }
  @Transactional
  public Task retry(long id,AdminPrincipal admin){
    task(id,admin);jdbc.queryForList("SELECT id FROM activity_copy_worker WHERE id=1 FOR UPDATE");
    var rows=jdbc.queryForList("SELECT source_activity_id,status,target_activity_id FROM activity_copy_task WHERE id=? FOR UPDATE",id);var r=rows.getFirst();
    if(!"FAILED".equals(r.get("status")))throw DomainException.conflict("COPY_RETRY_INVALID","只有失败的配置复用任务可以重试");
    access.requireActivityAccess(admin,CopySnapshot.number(r.get("source_activity_id")));
    if(jdbc.queryForList("SELECT id FROM activity WHERE id=? AND deletion_requested_at IS NULL AND configuration_state='READY' FOR SHARE",Long.class,r.get("source_activity_id")).isEmpty())throw missing();
    if(jdbc.queryForObject("SELECT COUNT(*) FROM activity_copy_task WHERE status IN ('QUEUED','RUNNING')",Integer.class)>=queueLimit)throw DomainException.conflict("COPY_QUEUE_FULL","配置复用任务较多，请稍后再试");
    jdbc.update("UPDATE activity_copy_task SET status='QUEUED',stage='QUEUED',failure_message=NULL,attempt_count=0,updated_at=UTC_TIMESTAMP(3) WHERE id=?",id);
    return task(id,admin);
  }
  @Transactional
  public void discard(long id,AdminPrincipal admin){
    task(id,admin);jdbc.queryForList("SELECT id FROM activity_copy_worker WHERE id=1 FOR UPDATE");
    jdbc.queryForList("SELECT id FROM activity_copy_task WHERE id=? FOR UPDATE",id);
    var t=task(id,admin);if(!"FAILED".equals(t.status()))throw DomainException.conflict("COPY_DISCARD_INVALID","只有失败任务可以放弃");
    // Use the existing bounded deletion worker to clean this private failed draft and reserved files.
    jdbc.update("INSERT INTO activity_deletion_task(activity_id,activity_code,activity_name,department_id,department_name,requested_by,requested_by_name,reason) SELECT a.id,a.activity_code,a.name,a.department_id,d.department_name,?,?,? FROM activity a JOIN department d ON d.id=a.department_id WHERE a.id=?",admin.id(),admin.displayName(),"放弃未完成的活动配置复用",t.activityId());
    jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?",t.activityId());
    jdbc.update("DELETE FROM activity_copy_file WHERE task_id=?",id);
    jdbc.update("UPDATE activity_copy_task SET status='CANCELLED',snapshot_json=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?",id);
  }
  long insert(String sql,Object...args){
    var keys=new GeneratedKeyHolder();jdbc.update(connection->{var ps=connection.prepareStatement(sql,java.sql.Statement.RETURN_GENERATED_KEYS);for(int i=0;i<args.length;i++)ps.setObject(i+1,args[i]);return ps;},keys);
    return Objects.requireNonNull(keys.getKey()).longValue();
  }
  String encode(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);}}
  static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
  private static DomainException missing(){return DomainException.notFound("COPY_NOT_FOUND","来源活动或复制任务不存在");}
}
