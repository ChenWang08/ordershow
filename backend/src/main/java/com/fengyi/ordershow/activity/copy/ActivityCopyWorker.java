package com.fengyi.ordershow.activity.copy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityInfoChanges;
import com.fengyi.ordershow.catalog.ProductCatalogChanges;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.storage.StorageService;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;

/** Durable global lease; object I/O is outside database transactions. Idle instances do not poll. */
@Service
public class ActivityCopyWorker implements AutoCloseable {
  private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ActivityCopyWorker.class);
  private final CopyResources resources;
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final AtomicBoolean awake=new AtomicBoolean();
  private final AtomicLong wakeGeneration=new AtomicLong();
  private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"configuration-copy");t.setDaemon(true);return t;});
  public ActivityCopyWorker(CopyResources resources,ObjectMapper json){this.resources=resources;this.jdbc=resources.jdbc;this.json=json;}
  @EventListener(ApplicationReadyEvent.class) public void recover(){wake();}
  public void wake(){wakeGeneration.incrementAndGet();if(!executor.isShutdown()&&awake.compareAndSet(false,true))executor.execute(this::run);}
  private void run(){
    long generation=wakeGeneration.get();
    boolean pending=false;
    try{tick();pending=Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM activity_copy_task WHERE status IN ('QUEUED','RUNNING'))",Boolean.class));}
    catch(Exception e){log.warn("Configuration copy worker will recover on the next task/status request",e);}
    finally{
      if(pending&&!executor.isShutdown())executor.schedule(this::run,2,TimeUnit.SECONDS);
      else {
        awake.set(false);
        // An enqueue between the pending query and clearing awake must not lose its wake-up.
        if(wakeGeneration.get()!=generation)wake();
      }
    }
  }
  record Claim(long id,long target,long source,long admin,String token,String snapshot){}
  Claim claim(){
    return resources.tx.execute(status->{
      var slot=jdbc.queryForList("SELECT task_id,lease_token,lease_expires_at FROM activity_copy_worker WHERE id=1 FOR UPDATE").getFirst();
      if(slot.get("task_id")!=null&&Boolean.TRUE.equals(jdbc.queryForObject("SELECT lease_expires_at>UTC_TIMESTAMP(3) FROM activity_copy_worker WHERE id=1",Boolean.class)))return null;
      var jobs=slot.get("task_id")==null?jdbc.queryForList("SELECT * FROM activity_copy_task WHERE status='QUEUED' ORDER BY id LIMIT 1 FOR UPDATE"):
          jdbc.queryForList("SELECT * FROM activity_copy_task WHERE id=? AND status='RUNNING' FOR UPDATE",slot.get("task_id"));
      if(jobs.isEmpty()){
        jdbc.update("UPDATE activity_copy_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1");return null;
      }
      var job=jobs.getFirst();long id=CopySnapshot.number(job.get("id"));
      if(((Number)job.get("attempt_count")).intValue()>=3){
        jdbc.update("UPDATE activity_copy_task SET status='FAILED',failure_message='任务多次中断，请重试或放弃本次复制',updated_at=UTC_TIMESTAMP(3) WHERE id=?",id);
        jdbc.update("UPDATE activity_copy_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1");return null;
      }
      String token=UUID.randomUUID().toString();
      jdbc.update("UPDATE activity_copy_worker SET task_id=?,lease_token=?,lease_expires_at=TIMESTAMPADD(SECOND,300,UTC_TIMESTAMP(3)) WHERE id=1",id,token);
      jdbc.update("UPDATE activity_copy_task SET status='RUNNING',stage='IMAGES',lease_token=?,attempt_count=attempt_count+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",token,id);
      return new Claim(id,CopySnapshot.number(job.get("target_activity_id")),CopySnapshot.number(job.get("source_activity_id")),CopySnapshot.number(job.get("created_by")),token,job.get("snapshot_json").toString());
    });
  }
  /** Package visibility lets integration tests run a deterministic single job without scheduling. */
  void tick(){
    Claim job=claim();if(job==null)return;
    try{
      requireCreator(job);
      var snapshot=json.readValue(job.snapshot(),CopySnapshot.Data.class);
      var deadline=java.time.Instant.now().plusSeconds(600);
      for(var file:snapshot.tables().get("files")){
        if(java.time.Instant.now().isAfter(deadline))throw DomainException.conflict("COPY_TIME_LIMIT","本次复制耗时较长，已保留进度，请点击重试继续");
        copyFile(job,file);
      }
      var provenance=provenance(job);
      byte[] content=("{\"configurationCopyTask\":"+job.id()+"}").getBytes(StandardCharsets.UTF_8);
      resources.objects.put(provenance.bucket(),provenance.objectKey(),new ByteArrayInputStream(content),content.length,"application/json");
      pulse(job);
      resources.tx.executeWithoutResult(status->materialize(job,snapshot,provenance));
    }catch(Exception error){
      log.warn("Configuration copy {} failed",job.id(),error);
      String message=error instanceof DomainException?error.getMessage():"配置复制暂未完成，请重试；持续失败请联系管理员";
      jdbc.update("UPDATE activity_copy_task SET status='FAILED',failure_message=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='RUNNING' AND lease_token=?",message.substring(0,Math.min(300,message.length())),job.id(),job.token());
    }finally{
      jdbc.update("UPDATE activity_copy_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1 AND lease_token=?",job.token());
    }
  }
  private void requireCreator(Claim job){
    if(!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM admin_user u JOIN activity a ON a.id=? JOIN department d ON d.id=a.department_id AND d.status='ACTIVE' WHERE u.id=? AND u.status='ACTIVE' AND (u.role_code='SUPER_ADMIN' OR (u.role_code='DEPARTMENT_ADMIN' AND u.department_id=a.department_id)))",Boolean.class,job.target(),job.admin())))
      throw DomainException.forbidden("COPY_CREATOR_UNAVAILABLE","创建人的管理员权限已变更，请联系管理员处理");
  }
  private void pulse(Claim job){
    if(jdbc.update("UPDATE activity_copy_worker SET lease_expires_at=TIMESTAMPADD(SECOND,300,UTC_TIMESTAMP(3)) WHERE id=1 AND task_id=? AND lease_token=? AND lease_expires_at>UTC_TIMESTAMP(3)",job.id(),job.token())!=1)
      throw DomainException.conflict("COPY_LEASE_LOST","复制任务已由其他服务接管，请等待最新结果");
  }
  private void copyFile(Claim job,Map<String,Object> file)throws Exception {
    pulse(job);long source=CopySnapshot.number(file.get("id"));
    var row=jdbc.queryForList("SELECT target_file_id,copied FROM activity_copy_file WHERE task_id=? AND source_file_id=?",job.id(),source).getFirst();
    if(Boolean.TRUE.equals(row.get("copied"))||Integer.valueOf(1).equals(row.get("copied")))return;
    if(!Objects.equals(file.get("storage_provider"),resources.objects.provider()))throw DomainException.conflict("COPY_STORAGE_MISMATCH","来源图片的存储类型与当前环境不一致");
    long target=row.get("target_file_id")==null?Objects.requireNonNull(resources.tx.execute(status->{
      long id=insert("stored_file",map("activity_id",job.target(),"storage_provider",resources.objects.provider(),"bucket_name",resources.bucket,
          "object_key",job.target()+"/"+file.get("file_purpose").toString().toLowerCase(Locale.ROOT)+"/copy-"+job.id()+"-"+source,
          "original_filename",file.get("original_filename"),"content_type",file.get("content_type"),"size_bytes",file.get("size_bytes"),
          "sha256",file.get("sha256"),"file_purpose",file.get("file_purpose"),"reference_count",1,"created_by",job.admin()));
      jdbc.update("UPDATE activity_copy_file SET target_file_id=? WHERE task_id=? AND source_file_id=?",id,job.id(),source);return id;
    })):CopySnapshot.number(row.get("target_file_id"));
    var from=new StorageService.FileMeta(source,file.get("bucket_name").toString(),file.get("object_key").toString(),file.get("original_filename").toString(),file.get("content_type").toString(),CopySnapshot.number(file.get("size_bytes")));
    resources.storage.copyImage(from,resources.storage.meta(target));pulse(job);
    resources.tx.executeWithoutResult(status->{
      int changed=jdbc.update("UPDATE activity_copy_file SET copied=TRUE WHERE task_id=? AND source_file_id=? AND copied=FALSE",job.id(),source);
      jdbc.update("UPDATE activity_copy_task SET copied_files=copied_files+?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?",changed,job.id(),job.token());
    });
  }
  private StorageService.FileMeta provenance(Claim job){
    String key=job.target()+"/other/configuration-copy-"+job.id()+".json";
    var ids=jdbc.queryForList("SELECT id FROM stored_file WHERE activity_id=? AND bucket_name=? AND object_key=?",Long.class,job.target(),resources.bucket,key);
    long id=ids.isEmpty()?insert("stored_file",map("activity_id",job.target(),"storage_provider",resources.objects.provider(),"bucket_name",resources.bucket,"object_key",key,
        "original_filename","历史活动配置复用.json","content_type","application/json","size_bytes",("{\"configurationCopyTask\":"+job.id()+"}").getBytes(StandardCharsets.UTF_8).length,
        "sha256",ActivityCopyService.hash("{\"configurationCopyTask\":"+job.id()+"}"),"file_purpose","OTHER","reference_count",1,"created_by",job.admin())):ids.getFirst();
    return resources.storage.meta(id);
  }
  private void materialize(Claim job,CopySnapshot.Data data,StorageService.FileMeta provenance){
    var slot=jdbc.queryForList("SELECT lease_token FROM activity_copy_worker WHERE id=1 FOR UPDATE").getFirst();
    if(!job.token().equals(slot.get("lease_token")))throw DomainException.conflict("COPY_LEASE_LOST","复制执行许可已变化");
    if(jdbc.queryForList("SELECT id FROM activity WHERE id=? AND configuration_state='COPYING' AND deletion_requested_at IS NULL FOR UPDATE",Long.class,job.target()).isEmpty())throw DomainException.conflict("COPY_TARGET_CHANGED","新活动状态已变化");
    requireCreator(job);
    jdbc.update("UPDATE activity_copy_task SET stage='CONFIGURATION',updated_at=UTC_TIMESTAMP(3) WHERE id=?",job.id());
    var files=new HashMap<Long,Long>();jdbc.queryForList("SELECT source_file_id,target_file_id FROM activity_copy_file WHERE task_id=? AND copied=TRUE",job.id()).forEach(r->files.put(CopySnapshot.number(r.get("source_file_id")),CopySnapshot.number(r.get("target_file_id"))));
    if(files.size()!=data.tables().get("files").size())throw new IllegalStateException("Image copy incomplete");
    var tables=data.tables();
    if(data.selection().whitelist()){
      batch("activity_region",tables.get("regions"),r->{r.put("activity_id",job.target());});
      long[] version=version(job,"WHITELIST",tables.get("customers").size(),provenance.id());
      batch("activity_customer",tables.get("customers"),r->{r.remove("id");r.put("activity_id",job.target());r.put("source_import_task_id",version[0]);r.put("data_version_id",version[1]);});
    }
    if(data.selection().products()){
      long[] version=version(job,"PRODUCT",tables.get("products").size(),provenance.id());
      batch("activity_product",tables.get("products"),r->{r.remove("id");r.put("activity_id",job.target());r.put("source_import_task_id",version[0]);r.put("data_version_id",version[1]);});
      var byKey=new HashMap<String,Long>();jdbc.queryForList("SELECT id,business_key FROM activity_product WHERE activity_id=? AND data_version_id=?",job.target(),version[1]).forEach(r->byKey.put(r.get("business_key").toString(),CopySnapshot.number(r.get("id"))));
      var products=new HashMap<Long,Long>();tables.get("products").forEach(r->products.put(CopySnapshot.number(r.get("id")),byKey.get(r.get("business_key").toString())));
      var names=Map.of("tiers","activity_product_price_tier","branches","activity_product_branch_scope","dealerScopes","activity_product_dealer_scope","dealerMembers","activity_product_dealer_member","images","product_image");
      // Dealer members reference their scope: insertion order must not depend on Map iteration.
      for(String key:List.of("tiers","branches","dealerScopes","dealerMembers","images"))batch(names.get(key),tables.get(key),r->{
        r.put("activity_product_id",Objects.requireNonNull(products.get(CopySnapshot.number(r.get("activity_product_id")))));
        if(key.equals("images")){r.put("stored_file_id",Objects.requireNonNull(files.get(CopySnapshot.number(r.get("stored_file_id")))));r.put("created_by",job.admin());}
      });
    }
    if(data.selection().lottery()){
      long rule=insert("lottery_rule",map("activity_id",job.target(),"name",tables.get("rule").getFirst().get("name"),"status","DRAFT","created_by",job.admin(),"updated_by",job.admin()));
      batch("lottery_round",tables.get("rounds"),r->{r.put("activity_id",job.target());r.put("lottery_rule_id",rule);r.put("status","DRAFT");if(r.get("prize_image_file_id")!=null)r.put("prize_image_file_id",Objects.requireNonNull(files.get(CopySnapshot.number(r.get("prize_image_file_id")))));});
    }
    if(data.selection().products()||data.selection().whitelist())ProductCatalogChanges.all(jdbc,job.target());
    ActivityInfoChanges.record(jdbc,job.target());
    jdbc.update("UPDATE activity SET configuration_state='READY' WHERE id=?",job.target());
    jdbc.update("UPDATE activity_copy_task SET status='COMPLETED',stage='COMPLETED',snapshot_json=NULL,failure_message=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?",job.id(),job.token());
    jdbc.update("DELETE FROM activity_copy_file WHERE task_id=?",job.id());
    jdbc.update("INSERT INTO audit_log(activity_id,actor_type,admin_user_id,action_code,object_type,object_id,reason,result,trace_id,occurred_at) VALUES(?,'ADMIN',?,'ACTIVITY_CONFIGURATION_COPIED','ACTIVITY',?,?,'SUCCESS',?,UTC_TIMESTAMP(3))",job.target(),job.admin(),Long.toString(job.target()),"复用来源活动 #"+job.source(),UUID.randomUUID().toString());
  }
  private long[] version(Claim job,String type,int count,long file){
    long task=insert("import_task",map("activity_id",job.target(),"import_type",type,"status","COMPLETED","source_file_id",file,"file_sha256",new byte[32],"input_count",count,"added_count",count,"created_by",job.admin(),"confirmed_by",job.admin()));
    long version=insert("import_publish_version",map("activity_id",job.target(),"data_type",type,"version_no",1,"source_import_task_id",task,"status","PUBLISHED","row_count",count,"created_by",job.admin()));
    jdbc.update("UPDATE import_publish_version SET ready_at=UTC_TIMESTAMP(3),published_at=UTC_TIMESTAMP(3) WHERE id=?",version);
    jdbc.update("UPDATE import_task SET published_version_id=?,confirmed_at=UTC_TIMESTAMP(3),completed_at=UTC_TIMESTAMP(3) WHERE id=?",version,task);
    insert("activity_data_binding",map("activity_id",job.target(),"data_type",type,"current_version_id",version,"updated_by",job.admin()));return new long[]{task,version};
  }
  private void batch(String table,List<Map<String,Object>> sources,java.util.function.Consumer<Map<String,Object>> adapt){
    if(sources.isEmpty())return;
    // Bounded JDBC batches; no per-row service calls, pricing synchronization, or cache notifications.
    for(int start=0;start<sources.size();start+=200){
      var rows=new ArrayList<Map<String,Object>>();for(var source:sources.subList(start,Math.min(start+200,sources.size()))){var row=new LinkedHashMap<>(source);adapt.accept(row);rows.add(row);}
      var columns=new ArrayList<>(rows.getFirst().keySet());
      jdbc.batchUpdate(sql(table,columns),rows,200,(ps,row)->{for(int i=0;i<columns.size();i++)ps.setObject(i+1,value(columns.get(i),row.get(columns.get(i))));});
    }
  }
  private long insert(String table,Map<String,Object> row){
    var columns=new ArrayList<>(row.keySet());var keys=new GeneratedKeyHolder();
    jdbc.update(connection->{var ps=connection.prepareStatement(sql(table,columns),java.sql.Statement.RETURN_GENERATED_KEYS);for(int i=0;i<columns.size();i++)ps.setObject(i+1,value(columns.get(i),row.get(columns.get(i))));return ps;},keys);
    return keys.getKey()==null?0:keys.getKey().longValue();
  }
  private static String sql(String table,List<String> columns){return "INSERT INTO "+table+"("+String.join(",",columns)+") VALUES("+String.join(",",Collections.nCopies(columns.size(),"?"))+")";}
  private static Object value(String column,Object value){return value instanceof String text&&Set.of("sha256","file_sha256","phone_lookup_hash","phone_ciphertext","confirmer_phone_ciphertext").contains(column)?HexFormat.of().parseHex(text):value;}
  private static Map<String,Object> map(Object...pairs){var result=new LinkedHashMap<String,Object>();for(int i=0;i<pairs.length;i+=2)result.put((String)pairs[i],pairs[i+1]);return result;}
  public void close(){executor.shutdownNow();}
}
