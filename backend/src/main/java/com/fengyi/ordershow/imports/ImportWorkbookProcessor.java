package com.fengyi.ordershow.imports;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
final class ImportWorkbookProcessor {
  private final ImportStagingWriter staging;
  private final ImportPreviewValidator validator;
  ImportWorkbookProcessor(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json) {
    staging = new ImportStagingWriter(jdbc, crypto, json);
    validator = new ImportPreviewValidator(jdbc, crypto, json, staging);
  }

  ParseSummary parse(long taskId, String importType, byte[] bytes) {
    try {
      ParsedWorkbook workbook = ImportWorkbookReader.read(taskId, importType, bytes);
      staging.persist(workbook);
      return workbook.summary();
    } catch (DomainException exception) { throw exception; }
    catch (Exception exception) { throw DomainException.unprocessable("IMPORT_PARSE_FAILED", exception.getMessage()); }
  }

  void revalidateTask(long taskId, String importType) { validator.revalidateTask(taskId, importType); }
  record ParseSummary(int inputCount, int addedCount, int warnings, int blocking) {}
}
