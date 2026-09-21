package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportWorkbookRules.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.security.CryptoService;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;


final class ImportStagingWriter {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ObjectMapper json;
  ImportStagingWriter(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json) { this.jdbc = jdbc; this.crypto = crypto; this.json = json; }
  void persist(ParsedWorkbook workbook) {
    for (var entry : workbook.entries()) {
      if (entry instanceof ParsedWorkbook.Staging row) {
        byte[] sensitive = row.sensitive() == null ? null : crypto.encrypt(writeJson(row.sensitive()));
        insertStaging(row.taskId(), row.sheet(), row.rowNo(), row.rowKey(), row.diffType(), row.validation(), row.data(), sensitive);
      } else if (entry instanceof ParsedWorkbook.Issue issue) {
        issue(issue.taskId(), issue.severity(), issue.code(), issue.sheet(), issue.rowNo(), issue.field(), issue.masked(), issue.message());
      }
    }
  }
  private void insertStaging(long taskId, String sheet, int rowNo, String rowKey, String validation,
                             Map<String, Object> data, byte[] sensitive) {
    insertStaging(taskId, sheet, rowNo, rowKey, "ADDED", validation, data, sensitive);
  }

  private void insertStaging(long taskId, String sheet, int rowNo, String rowKey, String diffType, String validation,
                             Map<String, Object> data, byte[] sensitive) {
    jdbc.update("""
        INSERT INTO import_staging_row(import_task_id, sheet_name, source_row_number, row_key, diff_type,
          validation_status, raw_data_json, normalized_data_json, sensitive_data_ciphertext)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, taskId, sheet, rowNo, truncate(rowKey, 500), diffType, validation, writeJson(data), writeJson(data), sensitive);
  }

  void issue(long taskId, String severity, String code, String sheet, int rowNo, String field,
                     String masked, String message) {
    jdbc.update("""
        INSERT INTO import_error(import_task_id, severity, error_code, sheet_name, source_row_number, field_name, raw_value_masked, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, taskId, severity, code, sheet, rowNo, field, masked, message);
  }

  private String writeJson(Object value) {
    try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }
}
