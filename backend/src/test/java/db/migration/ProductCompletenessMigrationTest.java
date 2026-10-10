package db.migration;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_PRODUCT_STATUS_MIGRATION", matches="order-show-e2e")
class ProductCompletenessMigrationTest {
  @Test void reclassifiesOnlyStatusAndPreservesBlockingRowsAndBusinessValues() throws Exception {
    try (var connection = DriverManager.getConnection("jdbc:mysql://host.docker.internal:33306/order_show_product_status_check?allowPublicKeyRetrieval=true&useSSL=false", "root", "e2e_root_only_not_for_business")) {
      var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection,true));
      assertEquals("order_show_product_status_check",jdbc.queryForObject("SELECT DATABASE()",String.class));
      String products = "SELECT COUNT(*) n, SUM(case_price) price, SUM(ton_case_factor) factor, SUM(lock_version) versions, SUM(is_orderable) orderable FROM activity_product";
      String orders = "SELECT COUNT(*) n, SUM(total_quantity) quantity, SUM(total_amount) amount, SUM(total_tons) tons, SUM(current_version_no) versions FROM customer_order";
      String blocked = "SELECT r.id,r.validation_status,r.normalized_data_json,r.edited_data_json FROM import_staging_row r JOIN import_task t ON t.id=r.import_task_id WHERE t.import_type='PRODUCT' AND t.status='PREVIEW_READY' AND r.validation_status='BLOCKED' ORDER BY r.id";
      String previews = "SELECT id,status,error_count FROM import_task WHERE import_type='PRODUCT' AND status='PREVIEW_READY' ORDER BY id";
      var beforeProducts=jdbc.queryForMap(products); var beforeOrders=jdbc.queryForMap(orders);
      var beforeBlocked=jdbc.queryForList(blocked); var beforePreviews=jdbc.queryForList(previews);
      Context context=mock(Context.class); when(context.getConnection()).thenReturn(connection);
      var migration=new V037__unify_product_completeness(); migration.migrate(context);
      var firstStatuses=jdbc.queryForList("SELECT id,data_status FROM activity_product ORDER BY id");
      var firstStats=jdbc.queryForList("SELECT id,status,warning_count,error_count FROM import_task ORDER BY id");
      Long issues=jdbc.queryForObject("SELECT COUNT(*) FROM import_error",Long.class);
      migration.migrate(context);
      assertEquals(firstStatuses,jdbc.queryForList("SELECT id,data_status FROM activity_product ORDER BY id"));
      assertEquals(firstStats,jdbc.queryForList("SELECT id,status,warning_count,error_count FROM import_task ORDER BY id"));
      assertEquals(issues,jdbc.queryForObject("SELECT COUNT(*) FROM import_error",Long.class));
      assertEquals(beforeProducts,jdbc.queryForMap(products)); assertEquals(beforeOrders,jdbc.queryForMap(orders));
      assertEquals(beforeBlocked,jdbc.queryForList(blocked)); assertEquals(beforePreviews,jdbc.queryForList(previews));
      assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id WHERE p.is_visible=TRUE AND p.data_status IN ('ACTIVE','INCOMPLETE') AND p.data_status <> CASE WHEN p.case_price>0 AND p.ton_case_factor>0 THEN 'ACTIVE' ELSE 'INCOMPLETE' END",Integer.class));
    }
  }
}
