package com.fengyi.ordershow.imports;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import com.fengyi.ordershow.imports.ImportService.ImportTask;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;


@Service
public class ImportTaskRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  public ImportTaskRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
  ImportTask task(long taskId) {
    List<ImportTask> rows = jdbc.query("""
        SELECT t.*, f.original_filename FROM import_task t JOIN stored_file f ON f.id = t.source_file_id WHERE t.id = ?
        """, this::mapTask, taskId);
    if (rows.size() != 1) throw DomainException.notFound("IMPORT_TASK_NOT_FOUND", "导入任务不存在");
    return rows.getFirst();
  }

  List<MaterializeRow> materializeRows(long taskId) {
    return jdbc.query("""
        SELECT id, normalized_data_json, edited_data_json, sensitive_data_ciphertext, edited_sensitive_data_ciphertext
        FROM import_staging_row WHERE import_task_id = ? AND is_deleted = FALSE AND validation_status <> 'BLOCKED' ORDER BY id
        """, (rs, rowNum) -> new MaterializeRow(rs.getLong("id"), readMap(rs.getString("normalized_data_json")),
        readMap(rs.getString("edited_data_json")), rs.getBytes("sensitive_data_ciphertext"),
        rs.getBytes("edited_sensitive_data_ciphertext")), taskId);
  }

  int cancelReplaceableTasks(long activityId, String importType, long beforeTaskId) {
    return jdbc.update("""
        UPDATE import_task SET status = 'CANCELLED'
        WHERE activity_id = ? AND import_type = ? AND id < ?
          AND status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY')
        """, activityId, importType, beforeTaskId);
  }

  Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  ImportTask mapTask(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new ImportTask(rs.getLong("id"), rs.getLong("activity_id"), rs.getString("import_type"), rs.getString("status"),
        rs.getString("original_filename"), rs.getInt("input_count"), rs.getInt("added_count"), rs.getInt("updated_count"),
        rs.getInt("unchanged_count"), rs.getInt("deactivated_count"), rs.getInt("warning_count"), rs.getInt("error_count"),
        rs.getString("failure_code"), rs.getString("failure_message"), rs.getLong("created_by"),
        rs.getObject("confirmed_by") == null ? 0 : rs.getLong("confirmed_by"), UtcTime.read(rs, "created_at"),
        UtcTime.read(rs, "completed_at"));
  }
}
