package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.storage.StorageService;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** One bounded, durable batch per transaction. Database row locking also coordinates replicas. */
@Service
public class ActivityDeletionWorker {
  private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ActivityDeletionWorker.class);
  record Step(String table,String predicate) {}
  static Step direct(String table){return new Step(table,"activity_id=?");}
  static Step child(String table,String column,String parent){return new Step(table,column+" IN (SELECT id FROM "+parent+" WHERE activity_id=?)");}
  static final List<Step> STEPS=List.of(
      direct("lottery_winner"),direct("lottery_candidate_snapshot"),direct("lottery_draw_attempt"),direct("lottery_round"),direct("lottery_rule"),
      direct("order_change_request"),child("order_version_item","order_version_id","order_version"),direct("order_version"),direct("order_operation"),
      child("order_item","order_id","customer_order"),child("order_dashboard_product_line_stat","order_id","customer_order"),child("order_dashboard_stat","order_id","customer_order"),
      direct("activity_ranking_product_snapshot"),direct("activity_ranking_order_snapshot"),direct("activity_ranking_snapshot"),
      direct("customer_order"),direct("h5_order_draft"),direct("h5_session"),direct("activity_attendee"),direct("visit_event"),
      direct("product_image_review_candidate"),child("product_image","activity_product_id","activity_product"),
      child("activity_product_dealer_member","activity_product_id","activity_product"),child("activity_product_dealer_scope","activity_product_id","activity_product"),
      child("activity_product_branch_scope","activity_product_id","activity_product"),child("activity_product_price_tier","activity_product_id","activity_product"),
      direct("product_scope_change_log"),direct("activity_product"),direct("activity_customer"),direct("activity_data_binding"),direct("import_publish_version"),
      child("import_error","import_task_id","import_task"),child("import_staging_row","import_task_id","import_task"),direct("import_task"),direct("export_task"),
      direct("activity_region"),direct("activity_dashboard_snapshot"),direct("price_sync_batch"),direct("api_idempotency"),direct("audit_log"),direct("domain_event_outbox"));
  static final int FILES=STEPS.size()+1, FINISH=FILES+1;
  static String stageName(int stage){return stage==0?"准备文件清理清单":stage<FILES?"清理关联业务数据":stage==FILES?"清理上传文件及图片衍生版本":"最终核验与清理活动记录";}
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final StorageService storage;
  private final int batchSize,maxRetries;
  private final long intervalMs;
  private final java.util.concurrent.atomic.AtomicBoolean scheduled=new java.util.concurrent.atomic.AtomicBoolean();
  private final java.util.concurrent.ExecutorService executor=java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
    var thread=new Thread(r,"activity-deletion"); thread.setDaemon(true); return thread;
  });

  public ActivityDeletionWorker(JdbcTemplate jdbc,PlatformTransactionManager manager,StorageService storage,
      @Value("${order-show.activity-deletion.batch-size:500}") int batchSize,
      @Value("${order-show.activity-deletion.max-retries:5}") int maxRetries,
      @Value("${order-show.activity-deletion.batch-interval-ms:500}") long intervalMs){
    this.jdbc=new JdbcTemplate(java.util.Objects.requireNonNull(jdbc.getDataSource())); this.jdbc.setQueryTimeout(10);
    this.tx=new TransactionTemplate(manager); this.storage=storage;
    this.batchSize=Math.clamp(batchSize,1,1000); this.maxRetries=Math.clamp(maxRetries,1,20); this.intervalMs=Math.max(100,intervalMs);
  }

  @Scheduled(fixedDelayString="${order-show.activity-deletion.tick-ms:500}")
  public void scheduleCleanup(){
    // Keep file I/O and cleanup SQL off the scheduler used by realtime events and activity clocks.
    if(scheduled.compareAndSet(false,true)) executor.execute(() -> {
      try { tick(); } finally { scheduled.set(false); }
    });
  }
  @jakarta.annotation.PreDestroy
  void close(){executor.shutdownNow();}

  public void tick(){
    long[] active={0,-1};
    try { tx.executeWithoutResult(status -> {
      var lock=jdbc.queryForList("SELECT id FROM activity_deletion_worker WHERE id=1 AND next_run_at<=UTC_TIMESTAMP(3) FOR UPDATE SKIP LOCKED",Integer.class);
      if(lock.isEmpty()) return;
      var jobs=jdbc.queryForList("""
          SELECT id,activity_id,stage,file_cursor,revision FROM activity_deletion_task
          WHERE status IN ('QUEUED','RUNNING') AND next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY id LIMIT 1 FOR UPDATE
          """);
      if(jobs.isEmpty()) return;
      var job=jobs.getFirst(); long task=((Number)job.get("id")).longValue(),id=((Number)job.get("activity_id")).longValue();
      int stage=((Number)job.get("stage")).intValue(); active[0]=task; active[1]=((Number)job.get("revision")).longValue();
      jdbc.update("UPDATE activity_deletion_worker SET next_run_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)) WHERE id=1",intervalMs*1000);
      jdbc.queryForList("SELECT id FROM activity WHERE id=? AND deletion_requested_at IS NOT NULL FOR UPDATE",Long.class,id);
      long rows=0,files=0; boolean advance=false;
      if(stage==0){
        long cursor=((Number)job.get("file_cursor")).longValue();
        var manifest=jdbc.queryForList("SELECT id,bucket_name,object_key FROM stored_file WHERE activity_id=? AND id>? ORDER BY id LIMIT ?",id,cursor,batchSize);
        for(var f:manifest){
          long fileId=((Number)f.get("id")).longValue();
          jdbc.update("INSERT IGNORE INTO activity_deletion_file(task_id,file_id,bucket_name,object_key) VALUES(?,?,?,?)",task,fileId,f.get("bucket_name"),f.get("object_key"));
          cursor=fileId;
        }
        jdbc.update("UPDATE activity_deletion_task SET file_cursor=? WHERE id=?",cursor,task);
        if(manifest.size()<batchSize){
          jdbc.update("UPDATE activity SET h5_background_file_id=NULL,desktop_background_file_id=NULL WHERE id=?",id);
          advance=true;
        }
      }else if(stage<=STEPS.size()){
        Step step=STEPS.get(stage-1);
        rows=jdbc.update("DELETE FROM "+step.table()+" WHERE "+step.predicate()+" LIMIT ?",id,batchSize);
        advance=rows==0;
      }else if(stage==FILES){
        // Storage is outside MySQL: retrying a missing object is intentionally successful.
        var manifest=jdbc.queryForList("SELECT file_id,bucket_name,object_key FROM activity_deletion_file WHERE task_id=? ORDER BY file_id LIMIT 1",task);
        for(var f:manifest){
          long fileId=((Number)f.get("file_id")).longValue();
          requireUnsharedFile(fileId,id);
          storage.removeWithVariants(new StorageService.FileMeta(fileId,f.get("bucket_name").toString(),f.get("object_key").toString(),"","application/octet-stream",0));
          jdbc.update("DELETE FROM activity_deletion_file WHERE task_id=? AND file_id=?",task,fileId); files++;
        }
        advance=manifest.isEmpty();
      }else if(stage==FINISH){
        rows=jdbc.update("DELETE FROM stored_file WHERE activity_id=? LIMIT ?",id,batchSize);
        if(rows==0){
          // FK checks stay enabled. An omitted relationship fails safely and remains retryable.
          jdbc.update("DELETE FROM activity WHERE id=? AND deletion_requested_at IS NOT NULL",id);
          jdbc.update("UPDATE activity_deletion_task SET status='COMPLETED',completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3),last_error=NULL,revision=revision+1 WHERE id=?",task);
          return;
        }
      }else throw new IllegalStateException("未知的删除阶段");
      jdbc.update("""
          UPDATE activity_deletion_task SET status='RUNNING',stage=stage+?,deleted_rows=deleted_rows+?,deleted_files=deleted_files+?,
            retry_count=0,last_error=NULL,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?
          """,advance?1:0,rows,files,task);
    });}catch(RuntimeException error){
      log.warn("Activity deletion batch failed for task {}",active[0],error);
      if(active[0]!=0) jdbc.update("""
          UPDATE activity_deletion_task SET status=IF(retry_count+1>=?,'FAILED','RUNNING'),retry_count=retry_count+1,
            next_attempt_at=TIMESTAMPADD(SECOND,LEAST(60,POW(2,retry_count)),UTC_TIMESTAMP(3)),
            last_error=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND revision=? AND status<>'COMPLETED'
          """,maxRetries,safeError(error),active[0],active[1]);
    }
  }

  private void requireUnsharedFile(long fileId,long activityId){
    long references=jdbc.queryForObject("""
        SELECT (SELECT COUNT(*) FROM product_image p JOIN activity_product a ON a.id=p.activity_product_id WHERE p.stored_file_id=? AND a.activity_id<>?)
          +(SELECT COUNT(*) FROM product_image_review_candidate WHERE stored_file_id=? AND activity_id<>?)
          +(SELECT COUNT(*) FROM lottery_round WHERE prize_image_file_id=? AND activity_id<>?)
          +(SELECT COUNT(*) FROM import_task WHERE (source_file_id=? OR auxiliary_file_id=?) AND activity_id<>?)
          +(SELECT COUNT(*) FROM export_task WHERE result_file_id=? AND activity_id<>?)
          +(SELECT COUNT(*) FROM activity WHERE (h5_background_file_id=? OR desktop_background_file_id=?) AND id<>?)
          +(SELECT COUNT(*) FROM stored_file other JOIN stored_file target ON target.id=?
            WHERE other.id<>target.id AND other.bucket_name=target.bucket_name AND other.object_key=target.object_key
              AND (other.activity_id IS NULL OR other.activity_id<>?))
        """,Long.class,fileId,activityId,fileId,activityId,fileId,activityId,fileId,fileId,activityId,fileId,activityId,fileId,fileId,activityId,fileId,activityId);
    if(references>0) throw new IllegalStateException("文件仍被其他活动引用，已暂停清理，请核对关联数据");
  }
  private static String safeError(RuntimeException error){
    // Do not expose SQL, credentials, object keys or stack traces to task readers.
    return error instanceof IllegalStateException && error.getMessage()!=null && error.getMessage().startsWith("文件仍被")
        ?error.getMessage():"清理暂未完成，请重试；持续失败时请检查数据库关联或文件存储服务";
  }
}
