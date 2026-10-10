package db.migration;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.ProductCompleteness;
import java.util.LinkedHashMap;
import java.util.Map;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Reclassify only the current catalog and editable previews; never change product values or publish a batch. */
public class V037__unify_product_completeness extends BaseJavaMigration {
  private static final String MESSAGE = "元/箱或吨箱转换系数缺失或无效；无有效箱价不可下单，缺系数按 0 吨计入";
  private final ObjectMapper json = new ObjectMapper();
  @Override public void migrate(Context context) throws Exception {
    JdbcTemplate jdbc = new JdbcTemplate(new SingleConnectionDataSource(context.getConnection(), true));
    for (var row : jdbc.queryForList("""
        SELECT p.id, p.case_price, p.ton_case_factor, p.data_status
        FROM activity_product p JOIN activity_data_binding b
          ON b.activity_id=p.activity_id AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id
        WHERE p.is_visible=TRUE AND p.data_status IN ('ACTIVE','INCOMPLETE')
        """)) {
      String status = ProductCompleteness.incomplete(row.get("case_price"), row.get("ton_case_factor")) ? "INCOMPLETE" : "ACTIVE";
      if (!status.equals(row.get("data_status"))) jdbc.update("UPDATE activity_product SET data_status=?, updated_at=updated_at WHERE id=?", status, row.get("id"));
    }
    for (Long task : jdbc.queryForList("""
        SELECT id FROM import_task WHERE import_type='PRODUCT'
          AND (status='PREVIEW_READY' OR (status='FAILED' AND failure_code='PUBLISH_FAILED'))
        """, Long.class)) {
      for (var row : jdbc.queryForList("""
          SELECT id,sheet_name,source_row_number,normalized_data_json,edited_data_json,validation_status
          FROM import_staging_row WHERE import_task_id=? AND is_deleted=FALSE AND validation_status IN ('VALID','WARNING')
          """, task)) {
        Map<String,Object> data = read(row.get("normalized_data_json"));
        data.putAll(read(row.get("edited_data_json")));
        boolean incomplete = ProductCompleteness.incomplete(data.get("casePrice"), data.get("tonCaseFactor"));
        // Other warnings, if present, are not silently dismissed by this migration.
        Integer otherWarnings = jdbc.queryForObject("""
            SELECT COUNT(*) FROM import_error WHERE import_task_id=? AND sheet_name=? AND source_row_number=?
              AND severity='WARNING' AND error_code<>'PRODUCT_INCOMPLETE' AND resolved_at IS NULL
            """, Integer.class, task, row.get("sheet_name"), row.get("source_row_number"));
        String status = incomplete || (otherWarnings != null && otherWarnings > 0) ? "WARNING" : "VALID";
        if (!status.equals(row.get("validation_status"))) jdbc.update("UPDATE import_staging_row SET validation_status=? WHERE id=?", status, row.get("id"));
        if (!incomplete) {
          jdbc.update("""
              UPDATE import_error SET resolved_at=UTC_TIMESTAMP(3)
              WHERE import_task_id=? AND sheet_name=? AND source_row_number=? AND error_code='PRODUCT_INCOMPLETE' AND resolved_at IS NULL
              """, task, row.get("sheet_name"), row.get("source_row_number"));
        } else {
          int existing = jdbc.update("""
              UPDATE import_error SET message=? WHERE import_task_id=? AND sheet_name=? AND source_row_number=?
                AND error_code='PRODUCT_INCOMPLETE' AND resolved_at IS NULL
              """, MESSAGE, task, row.get("sheet_name"), row.get("source_row_number"));
          if (existing == 0) jdbc.update("""
              INSERT INTO import_error(import_task_id,staging_row_id,severity,error_code,sheet_name,source_row_number,message)
              VALUES(?,?,'WARNING','PRODUCT_INCOMPLETE',?,?,?)
              """, task, row.get("id"), row.get("sheet_name"), row.get("source_row_number"), MESSAGE);
        }
      }
      jdbc.update("""
          UPDATE import_task SET warning_count=(SELECT COUNT(*) FROM import_staging_row
            WHERE import_task_id=? AND is_deleted=FALSE AND validation_status='WARNING'), updated_at=updated_at WHERE id=?
          """, task, task);
    }
  }
  private Map<String,Object> read(Object value) throws Exception {
    if (value == null) return new LinkedHashMap<>();
    return json.readValue(value.toString(), new TypeReference<LinkedHashMap<String,Object>>() {});
  }
}
