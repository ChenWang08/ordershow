package com.fengyi.ordershow.imports;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.*;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.customer.*;
import com.fengyi.ordershow.dashboard.*;
import com.fengyi.ordershow.security.CryptoService;
import java.math.BigDecimal;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;

/** Full production migration chain + actual whitelist writes + lifecycle capture, in a fixed test DB. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_RANKING_FILTER_TEST",matches="order-show-e2e")
class RankingMigrationIntegrationTest {
  @Test void upgradePreservesOrdersAndAllCustomerTypesRetainRegions() throws Exception {
    String base="jdbc:mysql://host.docker.internal:33306/";
    String options="?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC";
    String database="order_show_ranking_migration_test";
    var root=new JdbcTemplate(new DriverManagerDataSource(base+"order_show_e2e"+options,"root","e2e_root_only_not_for_business"));
    root.execute("DROP DATABASE IF EXISTS "+database); root.execute("CREATE DATABASE "+database+" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    var source=new DriverManagerDataSource(base+database+options,"root","e2e_root_only_not_for_business");
    var jdbc=new JdbcTemplate(source);
    Flyway.configure().dataSource(source).target("43").load().migrate();
    var json=new ObjectMapper().findAndRegisterModules();
    var tx=new TransactionTemplate(new DataSourceTransactionManager(source));
    tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    jdbc.update("INSERT INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'ranking-test','测试','unused','SUPER_ADMIN')");
    long department=jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'",Long.class);
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by) VALUES(1,?,'ranking-migration','测试','ACTIVE','2026-01-01','2099-01-01','2099-01-02',1,1)",department);
    jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,created_by) VALUES(1,1,'S3','test','fixture','test.xlsx','application/octet-stream',1,UNHEX(SHA2('fixture',256)),'IMPORT_SOURCE',1)");
    jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(1,1,'WHITELIST','COMPLETED',1,UNHEX(SHA2('fixture',256)),1)");
    jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES(1,1,'WHITELIST',1,1,'PUBLISHED',1)");
    jdbc.update("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES(1,'WHITELIST',1,1)");
    var properties=mock(OrderShowProperties.class);
    when(properties.phoneEncryptionKey()).thenReturn("ranking-fixture-key"); when(properties.phoneHmacKey()).thenReturn("ranking-fixture-hmac");
    var crypto=new CryptoService(properties);
    var regions=new ActivityRegionService(jdbc,crypto);
    var writer=new WhitelistImportWriter(jdbc,crypto,json,regions);
    var activities=mock(ActivityService.class);
    var active=json.readValue("{\"id\":1,\"code\":\"ranking-migration\",\"status\":\"ACTIVE\",\"regions\":[],\"companyRankingTopN\":90,\"branchRankingTopN\":30,\"timezone\":\"Asia/Shanghai\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2099-01-01T00:00:00Z\"}",ActivityService.ActivityView.class);
    when(activities.byId(1)).thenReturn(active); when(activities.byCode("ranking-migration")).thenReturn(active);
    var customers=new CustomerService(jdbc,crypto,activities,regions,mock(AttendanceMatchingService.class));
    int number=0;
    for(String type:List.of("GENERAL","SPECIAL","ALL")) {
      number++; final int n=number;
      tx.executeWithoutResult(s -> writer.write(1,1,1,List.of(new ImportData.MaterializeRow(n,
          Map.of("customerType",type,"dealerFullName","导入客户"+n,"branchName","测试分公司","regionName","华东","sequence",n),null,
          crypto.encrypt("{\"dealerPhone\":\"1380000000"+n+"\"}"),null))));
      assertThat(jdbc.queryForObject("SELECT region_code FROM activity_customer WHERE dealer_full_name=?",String.class,"导入客户"+n)).isNotBlank();
      var added=tx.execute(s -> customers.addCustomer(1,new CustomerService.CustomerWrite(type,"华西","测试分公司","手动","手动客户"+n,null,null,"1390000000"+n,null,null,0,"测试")));
      assertThat(added.regionCode()).isNotBlank();
      var changed=tx.execute(s -> customers.updateCustomer(1,added.id(),new CustomerService.CustomerWrite(type,"华北","测试分公司","手动",added.dealerFullName(),null,null,null,null,null,added.lockVersion(),"测试")));
      assertThat(changed.regionCode()).isNotBlank().isNotEqualTo(added.regionCode());
      var blank=tx.execute(s -> customers.updateCustomer(1,added.id(),new CustomerService.CustomerWrite(type,null,"测试分公司","手动",added.dealerFullName(),null,null,null,null,null,changed.lockVersion(),"测试")));
      assertThat(blank.regionCode()).isNull();
    }
    long customer=jdbc.queryForObject("SELECT id FROM activity_customer WHERE dealer_full_name='导入客户2'",Long.class);
    String region=jdbc.queryForObject("SELECT region_code FROM activity_customer WHERE id=?",String.class,customer);
    jdbc.update("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(1,1,'ALL','ALL','fixture','测试商品',100,100,1,1)");
    jdbc.update("""
        INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,region_code,dealer_full_name_snapshot,
          current_version_no,total_quantity,total_amount,first_submitted_at,last_submitted_at,last_modified_at)
        VALUES(1,1,?,'RANKING-TEST','SUBMITTED','SPECIAL',?,'导入客户2',1,2,200,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
        """,customer,region);
    jdbc.update("INSERT INTO order_item(order_id,activity_product_id,line_no,material_name,product_line,variety_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons) VALUES(1,1,1,'测试商品','项目A','品种A','ALL',FALSE,2,100,200,100,0.02)");
    var before=jdbc.queryForMap("SELECT * FROM customer_order WHERE id=1"); var items=jdbc.queryForList("SELECT * FROM order_item");
    var flyway=Flyway.configure().dataSource(source).target("44").load(); flyway.migrate(); flyway.validate();
    assertThat(flyway.info().current().getVersion()).isEqualTo(org.flywaydb.core.api.MigrationVersion.fromVersion("44"));
    assertThat(jdbc.queryForMap("SELECT * FROM customer_order WHERE id=1")).isEqualTo(before);
    assertThat(jdbc.queryForList("SELECT * FROM order_item")).isEqualTo(items);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('order_ranking_stat','order_ranking_product_stat')",Integer.class)).isZero();
    var rankingStore=new RankingStore(jdbc,json); var summaries=new DashboardSummaryStore(jdbc,true,"");
    var ranking=new RankingService(jdbc,activities,rankingStore,summaries);
    var legacy=new DashboardService(jdbc,activities,json,summaries); legacy.setRankingStore(rankingStore);
    var filter=new RankingFilter("SPECIAL",region,false,"项目A",false,List.of("品种A"),false,DashboardService.RankingMetric.AMOUNT);
    tx.executeWithoutResult(s -> summaries.refresh(1));
    assertThat(new BigDecimal(ranking.ranking("ranking-migration",filter).totals().get("total_amount").toString())).isEqualByComparingTo("200");
    var finished=json.readValue(json.writeValueAsString(active).replace("ACTIVE","FINISHED"),ActivityService.ActivityView.class);
    when(activities.byId(1)).thenReturn(finished); when(activities.byCode("ranking-migration")).thenReturn(finished);
    jdbc.update("UPDATE activity SET status='FINISHED' WHERE id=1");
    tx.executeWithoutResult(s -> legacy.freezeFinalSnapshots(new ActivityFinishedEvent(1)));
    assertThat(rankingStore.hasSnapshot(1)).isTrue();
    jdbc.update("UPDATE order_item SET line_amount=220 WHERE order_id=1"); jdbc.update("UPDATE customer_order SET total_amount=220,lock_version=1 WHERE id=1");
    tx.executeWithoutResult(s -> { summaries.refresh(1); legacy.refreshFinalSnapshots(1); });
    assertThat(new BigDecimal(ranking.ranking("ranking-migration",filter).totals().get("total_amount").toString())).isEqualByComparingTo("220");
    var archived=json.readValue(json.writeValueAsString(active).replace("ACTIVE","ARCHIVED"),ActivityService.ActivityView.class);
    when(activities.byId(1)).thenReturn(archived); when(activities.byCode("ranking-migration")).thenReturn(archived);
    jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=1");
    jdbc.update("UPDATE order_item SET line_amount=999 WHERE order_id=1");
    tx.executeWithoutResult(s -> legacy.refreshFinalSnapshots(1));
    assertThat(new BigDecimal(ranking.ranking("ranking-migration",filter).totals().get("total_amount").toString())).isEqualByComparingTo("220");
  }
}
