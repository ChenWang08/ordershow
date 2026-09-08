package com.fengyi.ordershow.imports;

import java.util.List;
import java.util.Map;
import com.fengyi.ordershow.imports.ImportWorkbookProcessor.ParseSummary;

record ParsedWorkbook(ParseSummary summary, List<Entry> entries) {
  sealed interface Entry permits Staging, Issue {}
  record Staging(long taskId, String sheet, int rowNo, String rowKey, String diffType, String validation,
                 Map<String, Object> data, Map<String, Object> sensitive) implements Entry {}
  record Issue(long taskId, String severity, String code, String sheet, int rowNo, String field,
               String masked, String message) implements Entry {}
}
