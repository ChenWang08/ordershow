package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.catalog.ProductDealerScopeService.Selection;
import com.fengyi.ordershow.common.DomainException;
import java.util.List;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_SCOPE_TEST", matches="1")
class ProductDealerScopeIntegrationTest {
  JdbcTemplate jdbc;
  ProductDealerScopeService service;
  @BeforeEach void setup() {
    // Fixed disposable test endpoint; cannot be redirected to a business database.
    var ds=new DriverManagerDataSource("jdbc:mysql://host.docker.internal:18306/scope_test?allowPublicKeyRetrieval=true&useSSL=false", "scope_test", "scope_test_only");
    jdbc=new JdbcTemplate(ds);
    jdbc.execute("SET FOREIGN_KEY_CHECKS=0");
    for(String t:List.of("activity_product_dealer_member","activity_product_dealer_scope","product_scope_change_log","activity_product_branch_scope","activity_customer","customer","activity_product","activity_data_binding")) jdbc.execute("DROP TABLE IF EXISTS "+t);
    jdbc.execute("SET FOREIGN_KEY_CHECKS=1");
    jdbc.execute("CREATE TABLE customer(id BIGINT UNSIGNED PRIMARY KEY)");
    jdbc.execute("CREATE TABLE activity_product(id BIGINT UNSIGNED PRIMARY KEY,activity_id BIGINT, data_version_id BIGINT,business_key VARCHAR(255),customer_type VARCHAR(16))");
    jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT,data_type VARCHAR(16),current_version_id BIGINT)");
    jdbc.execute("CREATE TABLE activity_product_branch_scope(activity_product_id BIGINT,normalized_branch_name VARCHAR(200))");
    jdbc.execute("CREATE TABLE activity_customer(id BIGINT PRIMARY KEY,customer_id BIGINT,activity_id BIGINT,data_version_id BIGINT,customer_type VARCHAR(16),branch_name VARCHAR(200),normalized_branch_name VARCHAR(200),dealer_full_name VARCHAR(255),normalized_dealer_full_name VARCHAR(255),dealer_short_name VARCHAR(200),is_active BOOLEAN)");
    new ResourceDatabasePopulator(new ClassPathResource("db/migration/V030__product_dealer_scope.sql")).execute(ds);
    jdbc.update("INSERT INTO customer VALUES (1),(2),(3),(4),(5)");
    jdbc.update("INSERT INTO activity_data_binding VALUES (10,'PRODUCT',100),(10,'WHITELIST',200),(20,'PRODUCT',300),(20,'WHITELIST',400)");
    jdbc.update("INSERT INTO activity_product VALUES (11,10,100,'sku','GENERAL'),(12,10,100,'universal','ALL'),(21,20,300,'sku','GENERAL')");
    jdbc.update("INSERT INTO activity_customer VALUES (101,1,10,200,'GENERAL','上海分','上海分','甲','甲','甲',TRUE),(102,2,10,200,'GENERAL','上海分','上海分','乙','乙','乙',TRUE),(103,3,10,200,'GENERAL','安徽分','安徽分','甲','甲','甲',TRUE),(104,4,10,200,'SPECIAL','上海分','上海分','特渠','特渠','特渠',TRUE),(201,5,20,400,'GENERAL','上海分','上海分','外活动','外活动','外活动',TRUE)");
    service=new ProductDealerScopeService(jdbc);
  }
  boolean allowed(long product,long customer) {
    return !jdbc.queryForList("SELECT p.id FROM activity_product p WHERE p.id=? " + ProductDealerScopeService.ALLOWED_SQL,Long.class,product,customer).isEmpty();
  }
  @Test void defaultsTypesSelectionAndSameNamesAreIsolated() {
    assertThat(allowed(11,101)).isTrue(); assertThat(allowed(11,104)).isFalse();
    assertThat(allowed(12,104)).isTrue(); assertThat(allowed(11,201)).isFalse();
    service.replace(10,11,"GENERAL",List.of("上海分","安徽分"),List.of(new Selection("上海分",List.of(1L))));
    assertThat(allowed(11,101)).isTrue(); assertThat(allowed(11,102)).isFalse();
    assertThat(allowed(11,103)).isTrue(); // 安徽分仍为全部；两个分公司是并集。
    assertThat(allowed(21,201)).isTrue();
    service.replace(10,11,"GENERAL",List.of("上海分","安徽分"),List.of(new Selection("上海分",List.of(1L)),new Selection("安徽分",List.of(3L))));
    assertThat(service.current(10).get(11L)).hasSize(2);
  }
  @Test void rejectsWrongActivityTypeBranchAndEmptySelectionBeforeDeleting() {
    service.replace(10,11,"GENERAL",List.of("上海分"),List.of(new Selection("上海分",List.of(1L))));
    for(var selection:List.of(new Selection("上海分",List.of(5L)),new Selection("上海分",List.of(4L)),new Selection("上海分",List.of(3L)),new Selection("上海分",List.of()))) {
      assertThatThrownBy(() -> service.replace(10,11,"GENERAL",List.of("上海分"),List.of(selection))).isInstanceOf(DomainException.class);
      assertThat(allowed(11,102)).isFalse();
    }
  }
  @Test void whitelistNewRowIdsInheritButRenameOrRemovalNeverOpensAccess() {
    service.replace(10,11,"GENERAL",List.of("上海分"),List.of(new Selection("上海分",List.of(1L))));
    jdbc.update("INSERT INTO activity_customer SELECT 301,customer_id,activity_id,201,customer_type,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,dealer_short_name,is_active FROM activity_customer WHERE id=101");
    jdbc.update("UPDATE activity_data_binding SET current_version_id=201 WHERE activity_id=10 AND data_type='WHITELIST'");
    assertThat(allowed(11,301)).isTrue(); assertThat(allowed(11,101)).isFalse();
    jdbc.update("UPDATE activity_customer SET normalized_dealer_full_name='改名',dealer_full_name='改名' WHERE id=301");
    assertThat(allowed(11,301)).isFalse();
    assertThat(service.current(10).get(11L).getFirst().members().getFirst().active()).isFalse();
    jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=301");
    assertThat(service.current(10).get(11L)).hasSize(1);
    assertThat(allowed(11,301)).isFalse();
  }
  @Test void productInheritanceUsesSameActivityExactIdentityAndNewExcelBranches() {
    service.replace(10,11,"GENERAL",List.of("上海分","安徽分"),List.of(new Selection("上海分",List.of(1L)),new Selection("安徽分",List.of(3L))));
    jdbc.update("INSERT INTO activity_product VALUES (31,10,101,'sku','GENERAL'),(32,10,101,'new','GENERAL'),(33,10,101,'sku-changed-branch','GENERAL'),(41,20,301,'sku','GENERAL')");
    jdbc.update("INSERT INTO activity_product_branch_scope VALUES(31,'上海分'),(31,'安徽分'),(33,'上海分')");
    service.inherit(10,101); service.inherit(20,301);
    var inherited=service.read(10,List.of(31L,32L,33L));
    assertThat(inherited.get(31L)).hasSize(2);
    assertThat(inherited.get(31L)).extracting(ProductDealerScopeService.Scope::branchName).containsExactlyInAnyOrder("上海分","安徽分");
    assertThat(allowed(31,102)).isFalse();
    assertThat(inherited).doesNotContainKey(32L).doesNotContainKey(33L);
    assertThat(service.read(20,List.of(41L))).isEmpty();
  }
}
