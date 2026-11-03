package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.storage.StorageService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.scheduling.annotation.Scheduled;

/** Only registered in the separate worker application. No business scheduler runs in this process. */
public class ExportRunner implements AutoCloseable {
  private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ExportRunner.class);
  private final ExportRepository tasks;
  private final ExportPolicy policy;
  private final CsvExportGenerator generator;
  private final StorageService storage;
  private final Path root;
  private final long maxBytes;
  private final int retentionHours;
  private Instant nextCleanup=Instant.EPOCH;
  private final java.util.concurrent.ScheduledExecutorService heartbeat=Executors.newSingleThreadScheduledExecutor();
  public ExportRunner(ExportRepository tasks,ExportPolicy policy,CsvExportGenerator generator,StorageService storage,Path root,long maxBytes,int retentionHours) {
    this.tasks=tasks;this.policy=policy;this.generator=generator;this.storage=storage;this.root=root.toAbsolutePath().normalize();
    this.maxBytes=Math.clamp(maxBytes,1048576L,10737418240L);this.retentionHours=Math.clamp(retentionHours,1,168);
  }
  @Scheduled(fixedDelayString="${order-show.export.tick-ms:2000}")
  public void tick() {
    Claim claim=null;Path directory=null;StorageService.FileMeta artifact=null;
    java.util.concurrent.ScheduledFuture<?> pulse=null;
    var lost=new AtomicBoolean();
    try {
      if(!Instant.now().isBefore(nextCleanup)) {
        nextCleanup=Instant.now().plusSeconds(60);tasks.expire();cleanup();
      }
      claim=tasks.claim();if(claim==null)return;
      final Claim active=claim;final Instant deadline=Instant.now().plusSeconds(600);
      pulse=heartbeat.scheduleWithFixedDelay(()->{
        try{if(Instant.now().isAfter(deadline) || !tasks.heartbeat(active))lost.set(true);}catch(Exception error){lost.set(true);}
      },10,10,TimeUnit.SECONDS);
      policy.requireCreator(claim.task().createdBy());policy.requireTask(claim.task());
      Files.createDirectories(root);
      if(Files.getFileStore(root).getUsableSpace()<maxBytes)throw new java.io.IOException("EXPORT_DISK_FULL");
      directory=Files.createTempDirectory(root,"task-"+claim.task().id()+"-");
      Result result=generator.generate(claim.task(),directory,(stage,orders,details)->{
        if(lost.get() || Thread.currentThread().isInterrupted())throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
        policy.requireTask(active.task());tasks.progress(active,stage,orders,details);
      });
      if(lost.get())throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
      String name=policy.requireActivity(claim.task().activityId(),false).name().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
      if(name.length()>80)name=name.substring(0,80);
      String filename=name+"_订单数据_"+DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss").withZone(ZoneId.of("Asia/Shanghai")).format(result.snapshotAt())+".zip";
      tasks.progress(claim,"UPLOADING",result.counts().get(0),result.counts().get(1));
      byte[] digest;
      try(var input=Files.newInputStream(result.zip())) {
        var sha=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[64*1024];int n;
        while((n=input.read(buffer))!=-1)sha.update(buffer,0,n);digest=sha.digest();
      }
      artifact=tasks.prepareFile(claim,storage,filename,Files.size(result.zip()),digest);
      storage.uploadExport(artifact,result.zip());
      if(lost.get())throw DomainException.conflict("EXPORT_STOPPED","导出已取消或执行许可已失效");
      tasks.complete(claim,artifact.id(),result,retentionHours);artifact=null;
    }catch(Exception error){
      log.error("Order export failed for task {}",claim==null?null:claim.task().id(),error);
      if(claim!=null) {
        String code=error instanceof DomainException domain?domain.code():"EXPORT_GENERATION_FAILED";
        String message=error instanceof DomainException?error.getMessage():"文件生成失败，请稍后重试或联系系统管理员";
        try{tasks.fail(claim,code,message);}catch(Exception failure){log.warn("Export failure will be recovered by lease",failure);}
      }
    }finally{
      if(pulse!=null)pulse.cancel(false);
      if(artifact!=null)try{storage.discardExport(artifact);}catch(Exception error){log.warn("Export artifact cleanup pending",error);}
      if(directory!=null)removeDirectory(directory);
      if(claim!=null)try{tasks.release(claim);}catch(Exception error){log.warn("Export lease release pending",error);}
    }
  }
  private void cleanup()throws Exception {
    for(Task task:tasks.expiredFiles()) {
      try { storage.discardExport(storage.meta(task.fileId()));tasks.cleared(task); }
      catch(DomainException error){if("FILE_NOT_FOUND".equals(error.code()))tasks.cleared(task);else log.warn("Export cleanup pending for task {}",task.id(),error);}
      catch(Exception error){log.warn("Export cleanup pending for task {}",task.id(),error);}
    }
    for(long file:tasks.orphanedFiles())try{storage.discardExport(storage.meta(file));}catch(Exception error){log.warn("Orphan export cleanup pending for file {}",file,error);}
    if(Files.isDirectory(root))try(var paths=Files.list(root)) {
      for(Path dir:paths.filter(p->p.getFileName().toString().startsWith("task-")).toList())
        if(Files.getLastModifiedTime(dir).toInstant().isBefore(Instant.now().minusSeconds(3600)))removeDirectory(dir);
    }
  }
  private void removeDirectory(Path dir) {
    if(!dir.toAbsolutePath().normalize().startsWith(root))throw new IllegalArgumentException("Unexpected export temporary path");
    try(var paths=Files.walk(dir)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
    catch(Exception error){log.warn("Temporary export cleanup pending: {}",dir,error);}
  }
  @Override public void close(){heartbeat.shutdownNow();}
}
