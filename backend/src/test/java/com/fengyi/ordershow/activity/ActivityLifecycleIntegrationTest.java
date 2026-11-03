package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.audit.AuditBatchWriter;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.dashboard.RankingStore;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.storage.StorageService;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Disposable, fixed test database only. No application deployment or production configuration. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_ACTIVITY_TEST",matches="activity-lifecycle-only")
class ActivityLifecycleIntegrationTest {
  static final String URL="jdbc:mysql://host.docker.internal:33326/order_show_activity_lifecycle_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static JdbcTemplate jdbc; static DataSourceTransactionManager manager; static TransactionTemplate tx;
  static long sequence=10;
  final AdminPrincipal root=new AdminPrincipal(1,"test","测试超管","SUPER_ADMIN",null,null,false);
  ActivityService activities; ActivityLifecycleManagement management; ActivityAccessPolicy policy; StorageService storage;
  @BeforeAll static void migrate(){
    var ds=new DriverManagerDataSource(URL,"root","activity_test_only");
    jdbc=new JdbcTemplate(ds); manager=new DataSourceTransactionManager(ds);tx=new TransactionTemplate(manager);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_activity_lifecycle_test");
    var flyway=Flyway.configure().dataSource(ds).locations("classpath:db/migration").cleanDisabled(false).load();
    flyway.clean(); flyway.migrate();
    jdbc.update("INSERT IGNORE INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'activity-test','test','unused','SUPER_ADMIN')");
    jdbc.update("INSERT IGNORE INTO department(id,department_code,department_name) VALUES(2,'ACTIVITY_TEST_OTHER','其他测试部门')");
  }
  @BeforeEach void services(){
    activities=new ActivityService(jdbc,ignored->{},new DepartmentAccessService(jdbc));
    var dashboard=new DashboardService(jdbc,activities,new ObjectMapper().findAndRegisterModules());
    dashboard.setRankingStore(new RankingStore(jdbc,new ObjectMapper().findAndRegisterModules()));
    management=new ActivityLifecycleManagement(jdbc,activities,new DepartmentAccessService(jdbc),dashboard);
    policy=new ActivityAccessPolicy(jdbc); storage=mock(StorageService.class);
  }
  long activity(String status){
    long id=sequence++;
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by) VALUES(?,1,?,?,?,'2026-01-01','2026-01-02','2026-01-03',1,1)",id,"ACT"+id,"活动"+id,status);
    return id;
  }
  ActivityDeletionWorker worker(int batch){return new ActivityDeletionWorker(jdbc,manager,storage,batch,2,100);}
  void tick(ActivityDeletionWorker w){jdbc.update("UPDATE activity_deletion_worker SET next_run_at=UTC_TIMESTAMP(3)");w.tick();}
  ActivityLifecycleManagement.DeletionTask task(long id){return jdbc.query("SELECT * FROM activity_deletion_task WHERE activity_id=?",ActivityLifecycleManagement::mapTask,id).getFirst();}
  ActivityLifecycleManagement.DeletionTask delete(long id){return tx.execute(s->management.delete(id,activities.byId(id).version(),"ACT"+id,"删除测试",root));}
  void finish(long id,ActivityDeletionWorker w){for(int i=0;i<250&&!task(id).status().equals("COMPLETED");i++){tick(w);assertThat(task(id).lastError()).isNull();}assertThat(task(id).status()).isEqualTo("COMPLETED");}

  @Test void archiveFreezeReadByExistingScopeUnarchiveAndVersionRules(){
    long id=activity("FINISHED"); seed(id,3);
    var archived=tx.execute(s->management.archive(id,0,"核对完成",root));
    assertThat(archived.status()).isEqualTo("ARCHIVED");
    assertThat(activities.byCode("ACT"+id).status()).isEqualTo("ARCHIVED");
    var department=new AdminPrincipal(2,"dept","部门","DEPARTMENT_ADMIN",1L,"默认",false);
    assertThatCode(()->new DepartmentAccessService(jdbc).requireActivityAccess(department,id)).doesNotThrowAnyException();
    assertThat(activities.listSummaries(department)).anyMatch(a->a.id()==id&&a.status().equals("ARCHIVED"));
    assertThatThrownBy(()->new DepartmentAccessService(jdbc).requireActivityAccess(new AdminPrincipal(3,"other","其他","DEPARTMENT_ADMIN",2L,"其他",false),id)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->{policy.lockWrite(id,false,false,false,false);return null;})).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->management.unarchive(id,0,"过期版本",root))).isInstanceOf(DomainException.class);
    String frozen=jdbc.queryForObject("SELECT CAST(payload_json AS CHAR) FROM activity_dashboard_snapshot WHERE activity_id=? AND snapshot_key='REPORT'",String.class,id);
    assertThat(frozen).contains("FINAL");
    var ended=tx.execute(s->management.unarchive(id,1,"继续核对",root));
    assertThat(ended.status()).isEqualTo("FINISHED");assertThat(ended.version()).isEqualTo(2);
    assertThatThrownBy(()->tx.execute(s->management.archive(id,2,"无权限",department))).isInstanceOf(DomainException.class);
  }
  @Test void rejectsActiveWrongCodeStaleVersionAndPendingChanges(){
    long id=activity("ACTIVE");
    jdbc.update("UPDATE activity SET ends_at='2099-01-01',event_ends_at='2099-01-02' WHERE id=?",id);
    assertThatThrownBy(()->delete(id)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->management.archive(id,0,"提前归档",root))).isInstanceOf(DomainException.class);
    long draft=activity("DRAFT");
    assertThatThrownBy(()->tx.execute(s->management.delete(draft,0,"WRONG","误操作",root))).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->management.delete(draft,1,"ACT"+draft,"旧版本",root))).isInstanceOf(DomainException.class);
    long pending=activity("FINISHED"); seed(pending,1);
    jdbc.update("UPDATE order_change_request SET status='PENDING' WHERE activity_id=?",pending);
    assertThatThrownBy(()->delete(pending)).isInstanceOf(DomainException.class);
    jdbc.update("UPDATE order_change_request SET status='REJECTED' WHERE activity_id=?",pending);
    assertThat(delete(pending).status()).isEqualTo("QUEUED");finish(pending,worker(30));
  }
  @Test void boundedCleanupResumesWithNewWorkerCleansAllRelationshipsAndKeepsOtherActivity(){
    long id=activity("FINISHED"), other=activity("FINISHED");seed(id,1201);seed(other,2);
    var before=tableCounts(other);var created=delete(id);
    assertThatThrownBy(()->activities.byId(id)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->policy.readableCode("ACT"+id)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->policy.readableFile(id*1000)).isInstanceOf(DomainException.class);
    assertThat(tx.execute(s->management.delete(id,0,"ACT"+id,"重复请求",root)).id()).isEqualTo(created.id());
    var first=worker(100); for(int i=0;i<20;i++)tick(first);
    long progress=task(id).deletedRows();assertThat(progress).isPositive();
    var resumed=worker(100);long previous=progress;
    for(int i=0;i<200&&!task(id).status().equals("COMPLETED");i++){
      tick(resumed);var t=task(id);assertThat(t.lastError()).isNull();assertThat(t.deletedRows()-previous).isBetween(0L,100L);previous=t.deletedRows();
    }
    assertThat(task(id).status()).isEqualTo("COMPLETED");assertThat(task(id).deletedFiles()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=?",Long.class,id)).isZero();
    assertThat(tableCounts(id).values()).allMatch(n->n==0);
    assertThat(tableCounts(other)).isEqualTo(before);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer WHERE id=?",Long.class,id*1000)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_user WHERE id=1",Long.class)).isEqualTo(1);
    verify(storage).removeWithVariants(argThat(f->f.id()==id*1000));
    assertThat(tx.execute(s->management.delete(id,0,"ACT"+id,"再次请求",root)).id()).isEqualTo(created.id());
  }
  @Test void fileFailureKeepsManifestAndRetryContinuesWithoutRestoringPartialData(){
    long id=activity("DRAFT");file(id);delete(id);
    doThrow(new IllegalStateException("storage offline")).when(storage).removeWithVariants(any());
    var w=worker(50);
    for(int i=0;i<150&&!task(id).status().equals("FAILED");i++){
      jdbc.update("UPDATE activity_deletion_task SET next_attempt_at=UTC_TIMESTAMP(3) WHERE activity_id=?",id);tick(w);
    }
    assertThat(task(id).status()).isEqualTo("FAILED");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_deletion_file WHERE task_id=?",Long.class,task(id).id())).isEqualTo(1);
    assertThatThrownBy(()->activities.byId(id)).isInstanceOf(DomainException.class);
    doNothing().when(storage).removeWithVariants(any());tx.execute(s->management.retry(task(id).id(),root));finish(id,worker(50));
  }
  @Test void auditAfterDeletionDoesNotRecreateActivityReferences(){
    long id=activity("DRAFT");delete(id);finish(id,worker(20));
    var writer=new AuditBatchWriter(jdbc,manager);
    writer.write(new Object[]{id,"ADMIN",1L,"ACTIVITY_ACCESS_FAILED","ACTIVITY",Long.toString(id),"", "FAILURE","HTTP_404","trace","127.0.0.1","test",java.time.LocalDateTime.now(),"test","SUPER_ADMIN"});
    assertThat(jdbc.queryForObject("SELECT activity_id FROM audit_log WHERE trace_id='trace' ORDER BY id DESC LIMIT 1",Long.class)).isNull();
  }
  @Test void schemaCoverageIncludesTablesWithoutForeignKeys(){
    Set<String> covered=new HashSet<>();ActivityDeletionWorker.STEPS.forEach(s->covered.add(s.table()));
    covered.addAll(List.of("stored_file","activity_deletion_task"));
    var tables=jdbc.queryForList("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='activity_id'",String.class);
    assertThat(covered).containsAll(tables);
  }
  @Test void onlySuperAdminCanPreviewDeleteListOrRetry(){
    long id=activity("DRAFT");
    var department=new AdminPrincipal(2,"dept","部门","DEPARTMENT_ADMIN",1L,"默认",false);
    assertThatThrownBy(()->management.preview(id,department)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->management.delete(id,0,"ACT"+id,"无权限",department))).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->management.tasks(department,1)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(s->management.retry(1,department))).isInstanceOf(DomainException.class);
    assertThat(management.tasks(root,Integer.MAX_VALUE)).isEmpty();
  }
  @Test void mvcRejectsDeletedActivityBeforeConditionalAndCachedFileResponses()throws Exception{
    long id=activity("ARCHIVED");file(id);
    try(var context=new org.springframework.web.context.support.AnnotationConfigWebApplicationContext()){
      context.setServletContext(new org.springframework.mock.web.MockServletContext());
      context.register(MvcTestConfiguration.class);
      context.addBeanFactoryPostProcessor(factory->{factory.registerSingleton("activityPolicy",policy);});
      context.refresh();
      var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(context).build();
      for(String path:List.of("/admin/activities/"+id+"/cached","/public/activities/ACT"+id,"/h5/activities/ACT"+id+"/cached","/screen/activities/ACT"+id+"/dashboard","/public/files/"+(id*1000)+"/thumbnail")){
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path).header("If-None-Match","\"cached\""))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotModified());
      }
      delete(id);
      for(String path:List.of("/admin/activities/"+id+"/cached","/public/activities/ACT"+id,"/h5/activities/ACT"+id+"/cached","/screen/activities/ACT"+id+"/dashboard","/public/files/"+(id*1000)+"/thumbnail"))
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path).header("If-None-Match","\"cached\""))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
      finish(id,worker(50));
    }
  }
  @org.springframework.context.annotation.Configuration
  @org.springframework.web.servlet.config.annotation.EnableWebMvc
  @org.springframework.context.annotation.Import({ActivityReadConfiguration.class,ReadProbe.class,com.fengyi.ordershow.common.GlobalExceptionHandler.class})
  static class MvcTestConfiguration {}
  @org.springframework.web.bind.annotation.RestController
  static class ReadProbe {
    @org.springframework.web.bind.annotation.GetMapping({"/admin/activities/{activityId}/cached","/public/activities/{activityCode}","/h5/activities/{activityCode}/cached","/screen/activities/{activityCode}/dashboard","/public/files/{fileId}/thumbnail"})
    public org.springframework.http.ResponseEntity<String> cached(){return org.springframework.http.ResponseEntity.ok().eTag("cached").body("cached content");}
  }
  @Test void cleanupLockCoordinatesReplicasAndDeletionWaitsForExistingWriter()throws Exception{
    long id=activity("DRAFT");
    var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
    try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
      var writer=pool.submit(()->tx.executeWithoutResult(s->{
        policy.lockWrite(id,false,false,false,true);entered.countDown();
        try{assertThat(release.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}
      }));
      assertThat(entered.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      var deletion=pool.submit(()->delete(id));
      try{assertThatThrownBy(()->deletion.get(150,java.util.concurrent.TimeUnit.MILLISECONDS)).isInstanceOf(java.util.concurrent.TimeoutException.class);}
      finally{release.countDown();}
      writer.get(5,java.util.concurrent.TimeUnit.SECONDS);deletion.get(5,java.util.concurrent.TimeUnit.SECONDS);
      assertThatThrownBy(()->tx.execute(s->{policy.lockWrite(id,false,false,false,true);return null;})).isInstanceOf(DomainException.class);
      long before=task(id).stage();
      var locked=new java.util.concurrent.CountDownLatch(1);var unlock=new java.util.concurrent.CountDownLatch(1);
      var replica=pool.submit(()->tx.executeWithoutResult(s->{
        jdbc.queryForList("SELECT id FROM activity_deletion_worker WHERE id=1 FOR UPDATE");locked.countDown();
        try{assertThat(unlock.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}
      }));
      try{assertThat(locked.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();worker(30).tick();assertThat(task(id).stage()).isEqualTo(before);}
      finally{unlock.countDown();}
      replica.get(5,java.util.concurrent.TimeUnit.SECONDS);finish(id,worker(30));
    }finally{release.countDown();}
  }
  @Test void sharedFilesPauseCleanupUntilOtherActivityReleasesReference(){
    long id=activity("DRAFT"),other=activity("DRAFT");file(id);
    jdbc.update("UPDATE activity SET desktop_background_file_id=? WHERE id=?",id*1000,other);
    delete(id);var w=worker(40);
    for(int i=0;i<150&&!task(id).status().equals("FAILED");i++){
      jdbc.update("UPDATE activity_deletion_task SET next_attempt_at=UTC_TIMESTAMP(3) WHERE activity_id=?",id);tick(w);
    }
    assertThat(task(id).status()).isEqualTo("FAILED");assertThat(task(id).lastError()).contains("其他活动引用");
    verify(storage,never()).removeWithVariants(any());
    assertThat(activities.byId(other).id()).isEqualTo(other);
    jdbc.update("UPDATE activity SET desktop_background_file_id=NULL WHERE id=?",other);
    tx.execute(s->management.retry(task(id).id(),root));finish(id,worker(40));
  }
  @Test void controllerAdvisorEnforcesArchiveAndDeletionAndRollsBackBusinessFailure(){
    long id=activity("DRAFT");
    try(var context=new org.springframework.context.annotation.AnnotationConfigApplicationContext()){
      context.registerBean(JdbcTemplate.class,()->jdbc);
      context.registerBean(org.springframework.transaction.PlatformTransactionManager.class,()->manager);
      context.registerBean(ActivityAccessPolicy.class,()->policy);
      context.register(ActivityWriteConfiguration.class,AdviceTestConfiguration.class,WriteProbe.class);
      context.refresh();
      var request=new org.springframework.mock.web.MockHttpServletRequest("PUT","/admin/activities/"+id+"/probe");
      request.setAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,Map.of("activityId",Long.toString(id)));
      org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(new org.springframework.web.context.request.ServletRequestAttributes(request));
      try{
        var probe=context.getBean(WriteProbe.class);
        assertThat(org.springframework.aop.support.AopUtils.isAopProxy(probe)).isTrue();
        assertThatThrownBy(()->probe.fail(id)).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT name FROM activity WHERE id=?",String.class,id)).isEqualTo("活动"+id);
        request.setRequestURI("/h5/activities/ACT"+id+"/order");
        request.setAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,Map.of("activityCode","ACT"+id));
        assertThatThrownBy(()->probe.fail(id)).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT name FROM activity WHERE id=?",String.class,id)).isEqualTo("活动"+id);
        probe.write(id);
        assertThat(jdbc.queryForObject("SELECT name FROM activity WHERE id=?",String.class,id)).isEqualTo("changed");
        request.setRequestURI("/admin/activities/"+id+"/probe");
        request.setAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,Map.of("activityId",Long.toString(id)));
        jdbc.update("UPDATE activity SET status='ARCHIVED',archived_at=UTC_TIMESTAMP(3) WHERE id=?",id);
        assertThatThrownBy(()->probe.write(id)).isInstanceOf(DomainException.class);
        jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?",id);
        assertThatThrownBy(()->probe.write(id)).isInstanceOf(DomainException.class);
      }finally{org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();}
    }
  }
  @org.springframework.context.annotation.Configuration
  @org.springframework.transaction.annotation.EnableTransactionManagement
  static class AdviceTestConfiguration {}
  @Test void draftRetryAndImportFailureKeepTheirOwnedTransactions()throws Exception{
    long id=activity("FINISHED");seed(id,1);
    jdbc.update("UPDATE activity SET status='ACTIVE',ends_at='2099-01-01',event_ends_at='2099-01-02' WHERE id=?",id);
    jdbc.update("UPDATE activity_product SET is_visible=TRUE,is_orderable=TRUE WHERE activity_id=?",id);
    sql("INSERT INTO import_task(id,activity_id,import_type,source_file_id,file_sha256,created_by,status) VALUES($b+1,$a,'WHITELIST',$b,UNHEX(SHA2('whitelist',256)),1,'COMPLETED')",id);
    sql("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,created_by,status) VALUES($b+1,$a,'WHITELIST',1,$b+1,1,'PUBLISHED')",id);
    sql("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES($a,'WHITELIST',$b+1,1)",id);
    sql("UPDATE activity_customer SET branch_name='branch',normalized_branch_name='branch',source_import_task_id=$b+1,data_version_id=$b+1 WHERE activity_id=$a",id);
    var mapper=new ObjectMapper().findAndRegisterModules();
    var drafts=new com.fengyi.ordershow.order.OrderDraftService(jdbc,activities,mapper,
        new com.fengyi.ordershow.order.DraftSaveTransactions(manager,new io.micrometer.core.instrument.simple.SimpleMeterRegistry()));
    var customer=new com.fengyi.ordershow.security.H5Principal(1,id,id*1000,"ACT"+id,"GENERAL",null,"branch",null,"客户",null);
    var body=new com.fengyi.ordershow.order.OrderDraftService.SaveDraftRequest(id*1000,1,List.of(new com.fengyi.ordershow.order.OrderDraftService.DraftItem(id*1000,2)));
    try(var context=new org.springframework.context.annotation.AnnotationConfigApplicationContext()){
      context.registerBean(JdbcTemplate.class,()->jdbc);context.registerBean(org.springframework.transaction.PlatformTransactionManager.class,()->manager);
      context.registerBean(ActivityAccessPolicy.class,()->policy);context.register(ActivityWriteConfiguration.class,AdviceTestConfiguration.class,WriteProbe.class);context.refresh();
      var probe=context.getBean(WriteProbe.class);
      var request=new org.springframework.mock.web.MockHttpServletRequest("PUT","/api/v1/h5/activities/ACT"+id+"/order-draft");request.setContextPath("/api/v1");
      request.setAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,Map.of("activityCode","ACT"+id));
      org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(new org.springframework.web.context.request.ServletRequestAttributes(request));
      try{
        probe.owned(()->drafts.save("ACT"+id,customer,body));
        assertThat(drafts.current("ACT"+id,customer).items().getFirst().quantity()).isEqualTo(2);
        jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=?",id);
        assertThatThrownBy(()->probe.owned(()->drafts.save("ACT"+id,customer,body))).isInstanceOf(DomainException.class);
        jdbc.update("UPDATE activity SET status='FINISHED' WHERE id=?",id);
        long imported=activity("DRAFT");file(imported);
        var processor=mock(Class.forName("com.fengyi.ordershow.imports.ImportWorkbookProcessor"),call->{
          if(call.getMethod().getName().equals("parse")) throw DomainException.unprocessable("IMPORT_PARSE_FAILED","测试解析失败");
          return org.mockito.Answers.RETURNS_DEFAULTS.answer(call);
        });
        when(storage.save(eq(imported),any(org.springframework.web.multipart.MultipartFile.class),eq("IMPORT_SOURCE"),eq(1L)))
            .thenReturn(new StorageService.StoredFile(imported*1000,imported,"test","test.xlsx","application/octet-stream",1,new byte[32]));
        when(storage.read(imported*1000)).thenReturn(new byte[]{1});
        var imports=new com.fengyi.ordershow.imports.ImportService(jdbc,storage,null,mapper,tx,null,null,null,new com.fengyi.ordershow.imports.ImportTaskRepository(jdbc,mapper));
        org.springframework.test.util.ReflectionTestUtils.setField(imports,"workbookProcessor",processor);
        request=new org.springframework.mock.web.MockHttpServletRequest("POST","/api/v1/admin/activities/"+imported+"/imports");request.setContextPath("/api/v1");
        request.setAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,Map.of("activityId",Long.toString(imported)));
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(new org.springframework.web.context.request.ServletRequestAttributes(request));
        assertThatThrownBy(()->probe.owned(()->imports.upload(imported,"PRODUCT",new org.springframework.mock.web.MockMultipartFile("file","test.xlsx","application/octet-stream",new byte[]{1}),1)))
            .isInstanceOf(DomainException.class);
        assertThat(jdbc.queryForObject("SELECT status FROM import_task WHERE activity_id=?",String.class,imported)).isEqualTo("FAILED");
        delete(imported);finish(imported,worker(40));
      }finally{org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();}
    }
    delete(id);finish(id,worker(40));
  }
  @org.springframework.web.bind.annotation.RestController
  static class WriteProbe {
    private final JdbcTemplate sql;
    WriteProbe(JdbcTemplate sql){this.sql=sql;}
    @org.springframework.web.bind.annotation.PutMapping("/admin/activities/{activityId}/probe")
    void write(long activityId){sql.update("UPDATE activity SET name='changed' WHERE id=?",activityId);}
    @org.springframework.web.bind.annotation.PutMapping("/admin/activities/{activityId}/probe-fail")
    void fail(long activityId){write(activityId);throw new IllegalStateException("rollback");}
    @org.springframework.web.bind.annotation.PostMapping("/owned")
    Object owned(java.util.function.Supplier<?> action){return action.get();}
  }
  Map<String,Long> tableCounts(long id){
    Map<String,Long> result=new LinkedHashMap<>();
    for(var step:ActivityDeletionWorker.STEPS) result.put(step.table(),jdbc.queryForObject("SELECT COUNT(*) FROM "+step.table()+" WHERE "+step.predicate(),Long.class,id));
    result.put("stored_file",jdbc.queryForObject("SELECT COUNT(*) FROM stored_file WHERE activity_id=?",Long.class,id));return result;
  }
  void sql(String query,long id){jdbc.execute(query.replace("$a",Long.toString(id)).replace("$b",Long.toString(id*1000)));}
  void file(long id){sql("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES($b,$a,'MINIO','test','activity/$a/test.png','test.png','image/png',1,UNHEX(SHA2('test',256)),'PRODUCT_IMAGE')",id);}
  void seed(long id,int items){
    file(id);
    sql("INSERT INTO import_task(id,activity_id,import_type,source_file_id,file_sha256,created_by,status) VALUES($b,$a,'PRODUCT',$b,UNHEX(SHA2('test',256)),1,'COMPLETED')",id);
    sql("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,created_by,status) VALUES($b,$a,'PRODUCT',1,$b,1,'PUBLISHED')",id);
    sql("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES($a,'PRODUCT',$b,1)",id);
    sql("INSERT INTO import_staging_row(id,import_task_id,source_row_number,diff_type,validation_status,raw_data_json) VALUES($b,$b,1,'ADDED','VALID','{}')",id);
    sql("INSERT INTO import_error(import_task_id,staging_row_id,severity,error_code,message) VALUES($b,$b,'WARNING','TEST','test')",id);
    sql("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES($b,'GENERAL','客户$a','customer$a')",id);
    sql("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES($b,$a,$b,'GENERAL','客户$a','customer$a',UNHEX(SHA2('phone$a',256)),'139****0000',$b,$b)",id);
    sql("INSERT INTO activity_attendee(activity_id,activity_customer_id,dealer_name_snapshot,source_import_task_id,data_version_id) VALUES($a,$b,'客户',$b,$b)",id);
    sql("INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES($a,$b,UNHEX(SHA2('session$a',256)),UNHEX(SHA2('csrf',256)),'2099-01-01',UTC_TIMESTAMP(3))",id);
    sql("INSERT INTO h5_order_draft(activity_id,activity_customer_id,items_json,expires_at) VALUES($a,$b,'[{\"productId\":1,\"quantity\":1}]','2099-01-01')",id);
    sql("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,case_price,source_import_task_id,data_version_id) VALUES($b,$a,'ALL','ALL','test','测试商品',10,$b,$b)",id);
    sql("INSERT INTO activity_product_price_tier(activity_product_id,min_quantity,case_price) VALUES($b,2,9)",id);
    sql("INSERT INTO activity_product_branch_scope(activity_product_id,branch_name,normalized_branch_name) VALUES($b,'分公司','branch')",id);
    sql("INSERT INTO activity_product_dealer_scope(activity_product_id,branch_name,normalized_branch_name) VALUES($b,'分公司','branch')",id);
    sql("INSERT INTO activity_product_dealer_member(activity_product_id,normalized_branch_name,customer_id,customer_type,normalized_dealer_full_name,dealer_full_name) VALUES($b,'branch',$b,'GENERAL','customer$a','客户$a')",id);
    sql("INSERT INTO product_scope_change_log(activity_id,activity_product_id,admin_user_id,before_json,after_json,reason) VALUES($a,$b,1,'{}','{}','测试')",id);
    sql("INSERT INTO product_image(activity_product_id,stored_file_id,source_type) VALUES($b,$b,'MANUAL')",id);
    sql("INSERT INTO product_image_review_candidate(activity_id,data_version_id,import_task_id,stored_file_id,archive_path,material_code,normalized_material_code,material_name,normalized_material_name) VALUES($a,$b,$b,$b,'test.png','test','test','测试商品','test')",id);
    sql("INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,dealer_full_name_snapshot,current_version_no,total_quantity,total_amount,first_submitted_at,last_submitted_at,last_modified_at) VALUES($b,$a,$b,'ORDER$a','SUBMITTED','GENERAL','客户',1,1,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",id);
    var products=new ArrayList<Object[]>();
    var batch=new ArrayList<Object[]>();
    for(int i=1;i<=items;i++){
      long productId=i==1?id*1000:10000000+id*10000+i;
      if(i>1) products.add(new Object[]{productId,id,"test"+i,id*1000,id*1000});
      batch.add(new Object[]{id*1000,productId,i});
    }
    if(!products.isEmpty()) jdbc.batchUpdate("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,case_price,source_import_task_id,data_version_id) VALUES(?,?,'ALL','ALL',?,'测试商品',10,?,?)",products);
    jdbc.batchUpdate("INSERT INTO order_item(order_id,activity_product_id,line_no,material_name,rebate_status,is_gift_box,quantity,case_price,line_amount) VALUES(?,?,?,'测试商品','ALL',FALSE,1,10,10)",batch);
    sql("INSERT INTO order_version(id,activity_id,order_id,version_no,customer_type,dealer_full_name_snapshot,total_quantity,total_amount,submitted_source,submitted_at,request_idempotency_key) VALUES($b,$a,$b,1,'GENERAL','客户',1,10,'H5',UTC_TIMESTAMP(3),'test')",id);
    sql("INSERT INTO order_version_item(order_version_id,activity_product_id,line_no,material_name,customer_type,rebate_status,is_gift_box,quantity,case_price,line_amount) VALUES($b,$b,1,'测试商品','GENERAL','ALL',FALSE,1,10,10)",id);
    sql("INSERT INTO order_operation(activity_id,order_id,operation_type,source,occurred_at) VALUES($a,$b,'FIRST_SUBMIT','H5',UTC_TIMESTAMP(3))",id);
    sql("INSERT INTO order_change_request(activity_id,order_id,activity_customer_id,request_type,base_order_version,base_lock_version,requested_items_json,idempotency_key,status) VALUES($a,$b,$b,'MODIFY',1,0,'[]','test','REJECTED')",id);
    sql("INSERT INTO order_dashboard_stat(order_id) VALUES($b)",id);
    sql("INSERT INTO order_dashboard_product_line_stat(order_id,is_gift_box) VALUES($b,FALSE)",id);
    sql("INSERT INTO price_sync_batch(batch_key,activity_id,admin_id,request_hash,result_json) VALUES('sync$a',$a,1,'test','{}')",id);
    sql("INSERT INTO api_idempotency(activity_id,actor_type,actor_id,endpoint_code,idempotency_key,request_hash,expires_at) VALUES($a,'ADMIN',1,'TEST','test',UNHEX(SHA2('test',256)),'2099-01-01')",id);
    sql("INSERT INTO visit_event(activity_id,activity_customer_id,event_type,occurred_at) VALUES($a,$b,'H5_OPEN',UTC_TIMESTAMP(3))",id);
    sql("INSERT INTO lottery_rule(id,activity_id,name,created_by,updated_by) VALUES($b,$a,'测试规则',1,1)",id);
    sql("INSERT INTO lottery_round(id,activity_id,lottery_rule_id,round_no,name,winner_count,candidate_scope,prize_image_file_id) VALUES($b,$a,$b,1,'测试轮次',1,'ALL_CUSTOMERS',$b)",id);
    sql("INSERT INTO lottery_draw_attempt(id,activity_id,round_id,attempt_no,candidate_count,winner_count,rule_snapshot_json,result_hash,drawn_at,drawn_by) VALUES($b,$a,$b,1,1,1,'{}',UNHEX(SHA2('test',256)),UTC_TIMESTAMP(3),1)",id);
    sql("INSERT INTO lottery_candidate_snapshot(id,activity_id,round_id,draw_attempt_id,activity_customer_id,dealer_full_name_snapshot,customer_type,qualification_source,random_sort_key,qualifying_order_id) VALUES($b,$a,$b,$b,$b,'客户','GENERAL','VALID_ORDERS',UNHEX(SHA2('test',256)),$b)",id);
    sql("INSERT INTO lottery_winner(activity_id,round_id,draw_attempt_id,candidate_snapshot_id,activity_customer_id,winner_position,dealer_display_name_snapshot) VALUES($a,$b,$b,$b,$b,1,'客户')",id);
    sql("INSERT INTO export_task(activity_id,export_type,status,result_file_id,created_by) VALUES($a,'ORDER_SUMMARY','COMPLETED',$b,1)",id);
    sql("INSERT INTO activity_region(activity_id,region_code,region_name) VALUES($a,'test','测试区')",id);
    sql("INSERT INTO activity_dashboard_snapshot(activity_id,snapshot_key,payload_json) VALUES($a,'REPORT','{}')",id);
    sql("INSERT INTO activity_ranking_snapshot(activity_id,options_json,data_version) VALUES($a,'{}',1)",id);
    sql("INSERT INTO activity_ranking_order_snapshot(activity_id,id,customer_type,dealer_full_name_snapshot,total_amount,total_quantity,last_submitted_at) VALUES($a,$b,'GENERAL','客户',10,1,UTC_TIMESTAMP(3))",id);
    sql("INSERT INTO activity_ranking_product_snapshot(activity_id,order_id,amount,quantity) VALUES($a,$b,10,1)",id);
    sql("INSERT INTO audit_log(activity_id,actor_type,action_code,object_type,result,trace_id,occurred_at) VALUES($a,'SYSTEM','TEST','ACTIVITY','SUCCESS','test',UTC_TIMESTAMP(3))",id);
    sql("INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at) VALUES($a,'TEST','test','TEST','{}',UTC_TIMESTAMP(3))",id);
    sql("UPDATE activity SET h5_background_file_id=$b,desktop_background_file_id=$b WHERE id=$a",id);
  }
}
