package com.fengyi.ordershow.imports;

import com.fengyi.ordershow.common.UtcTime;

import static com.fengyi.ordershow.imports.ImportValues.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.customer.AttendanceMatchingService;
import com.fengyi.ordershow.security.CryptoService;
import com.fengyi.ordershow.storage.StorageService;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ImportService {
  private final JdbcTemplate jdbc;
  private final StorageService storage;
  private final CryptoService crypto;
  private final ObjectMapper json;
  private final TransactionTemplate transactions;
  private final ImportWorkbookProcessor workbookProcessor;
  private final AttendanceMatchingService attendanceMatching;
  private final ImportPublisher publisher;
  private final ImportTaskRepository taskRepository;

  public ImportService(JdbcTemplate jdbc, StorageService storage, CryptoService crypto,
                       ObjectMapper json, TransactionTemplate transactions, ImportWorkbookProcessor workbookProcessor,
                       AttendanceMatchingService attendanceMatching, ImportPublisher publisher, ImportTaskRepository taskRepository) {
    this.jdbc = jdbc;
    this.storage = storage;
    this.crypto = crypto;
    this.json = json;
    this.transactions = transactions;
    this.workbookProcessor = workbookProcessor;
    this.attendanceMatching = attendanceMatching;
    this.publisher = publisher;
    this.taskRepository = taskRepository;
  }

  public ImportTask upload(long activityId, String importType, MultipartFile file, long adminId) {
    if (!Set.of("PRODUCT", "WHITELIST", "ATTENDANCE").contains(importType)) {
      throw DomainException.badRequest("IMPORT_TYPE_INVALID", "不支持的导入类型");
    }
    String filename = Objects.requireNonNullElse(file.getOriginalFilename(), "import.xlsx");
    if (!filename.toLowerCase(Locale.ROOT).endsWith(".xlsx") && !filename.toLowerCase(Locale.ROOT).endsWith(".xls")) {
      throw DomainException.badRequest("IMPORT_FILE_INVALID", "请选择 Excel 文件");
    }
    StorageService.StoredFile stored = storage.save(activityId, file, "IMPORT_SOURCE", adminId);
    long taskId = Objects.requireNonNull(transactions.execute(status -> {
      jdbc.queryForObject("SELECT id FROM activity WHERE id = ? FOR UPDATE", Long.class, activityId);
      taskRepository.cancelReplaceableTasks(activityId, importType, Long.MAX_VALUE);
      return insertTask(activityId, importType, stored, adminId);
    }));
    try {
      int parsing = jdbc.update("UPDATE import_task SET status = 'PARSING', started_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'UPLOADED'", taskId);
      if (parsing != 1) throw DomainException.conflict("IMPORT_REPLACED", "本次导入已被更新的文件替换");
      byte[] bytes = storage.read(stored.id());
      ImportWorkbookProcessor.ParseSummary summary = transactions.execute(status -> workbookProcessor.parse(taskId, importType, bytes));
      int previewReady = jdbc.update("""
          UPDATE import_task SET status = 'PREVIEW_READY', input_count = ?, added_count = ?, warning_count = ?, error_count = ?,
            preview_ready_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'PARSING'
          """, summary.inputCount(), summary.addedCount(), summary.warnings(), summary.blocking(), taskId);
      if (previewReady != 1) throw DomainException.conflict("IMPORT_REPLACED", "本次导入已被更新的文件替换");
      return task(taskId);
    } catch (Exception exception) {
      jdbc.update("UPDATE import_task SET status = 'FAILED', failed_at = UTC_TIMESTAMP(3), failure_code = 'PARSE_FAILED', failure_message = ? WHERE id = ? AND status <> 'CANCELLED'",
          truncate(exception.getMessage(), 900), taskId);
      if (exception instanceof DomainException domain) throw domain;
      throw DomainException.unprocessable("IMPORT_PARSE_FAILED", "Excel 解析失败：" + Objects.requireNonNullElse(exception.getMessage(), "文件格式不正确"));
    }
  }

  public List<ImportTask> tasks(long activityId) {
    return tasks(activityId, null);
  }

  public List<ImportTask> tasks(long activityId, String importType) {
    if (importType != null && !List.of("PRODUCT", "WHITELIST", "ATTENDANCE").contains(importType)) {
      throw DomainException.unprocessable("IMPORT_TYPE_INVALID", "导入类型无效");
    }
    String filter = importType == null ? "" : " AND t.import_type=?";
    Object[] args = importType == null ? new Object[] { activityId } : new Object[] { activityId, importType };
    return jdbc.query("""
        SELECT t.*, f.original_filename FROM import_task t JOIN stored_file f ON f.id = t.source_file_id
        WHERE t.activity_id = ?
        """ + filter + " ORDER BY t.created_at DESC", taskRepository::mapTask, args);
  }

  public ImportTask task(long taskId) { return taskRepository.task(taskId); }

  public List<StagingRow> rows(long taskId, String validationStatus) {
    String sql = "SELECT id, sheet_name, source_row_number, diff_type, validation_status, normalized_data_json, edited_data_json, is_deleted FROM import_staging_row WHERE import_task_id = ?" +
        (validationStatus == null || validationStatus.isBlank() ? "" : " AND validation_status = ?") + " ORDER BY id";
    Object[] args = validationStatus == null || validationStatus.isBlank() ? new Object[]{taskId} : new Object[]{taskId, validationStatus};
    return jdbc.query(sql, (rs, rowNum) -> new StagingRow(rs.getLong("id"), rs.getString("sheet_name"),
        rs.getInt("source_row_number"), rs.getString("diff_type"), rs.getString("validation_status"),
        readMap(rs.getString("normalized_data_json")), readMap(rs.getString("edited_data_json")), rs.getBoolean("is_deleted")), args);
  }

  public AttendanceMatchPreview attendanceMatchPreview(long taskId) {
    ImportTask task = task(taskId);
    if (!"ATTENDANCE".equals(task.importType())) {
      throw DomainException.badRequest("ATTENDANCE_PREVIEW_NOT_ALLOWED", "只有现场到场导入可以试算白名单关联");
    }
    Long whitelistVersionId = attendanceMatching.currentWhitelistVersion(task.activityId());
    List<MaterializeRow> sources = jdbc.query("""
        SELECT id, normalized_data_json, edited_data_json, sensitive_data_ciphertext, edited_sensitive_data_ciphertext
        FROM import_staging_row WHERE import_task_id = ? AND is_deleted = FALSE ORDER BY id
        """, (rs, rowNum) -> new MaterializeRow(rs.getLong("id"), readMap(rs.getString("normalized_data_json")),
        readMap(rs.getString("edited_data_json")), rs.getBytes("sensitive_data_ciphertext"),
        rs.getBytes("edited_sensitive_data_ciphertext")), taskId);
    List<AttendancePreviewDraft> drafts = new ArrayList<>();
    Set<Long> matchedCustomerIds = new java.util.LinkedHashSet<>();
    for (MaterializeRow source : sources) {
      Map<String, Object> data = source.effective();
      AttendanceMatchingService.MatchResult match = attendanceMatching.match(task.activityId(), whitelistVersionId,
          text(data.get("participantType")), text(data.get("branchName")), text(data.get("dealerFullName")));
      if (match.customerId() != null) matchedCustomerIds.add(match.customerId());
      drafts.add(new AttendancePreviewDraft(source.id(), match));
    }
    Map<Long, String> dealerNames = customerNames(matchedCustomerIds);
    List<AttendanceMatchPreviewRow> previewRows = drafts.stream().map(draft -> new AttendanceMatchPreviewRow(
        draft.stagingRowId(), draft.match().customerId(), draft.match().status(), draft.match().method(),
        draft.match().reasonCode(), draft.match().customerId() == null ? null : dealerNames.get(draft.match().customerId()),
        "MATCHED".equals(draft.match().status()))).toList();
    int matched = (int) previewRows.stream().filter(row -> "MATCHED".equals(row.matchStatus())).count();
    int pending = (int) previewRows.stream().filter(row -> "PENDING_CONFIRMATION".equals(row.matchStatus())).count();
    int unmatched = previewRows.size() - matched - pending;
    return new AttendanceMatchPreview(whitelistVersionId, Instant.now(), previewRows.size(), matched, pending, unmatched,
        matchedCustomerIds.size(), previewRows);
  }


  private Map<Long, String> customerNames(Set<Long> customerIds) {
    if (customerIds.isEmpty()) return Map.of();
    String placeholders = String.join(", ", Collections.nCopies(customerIds.size(), "?"));
    Map<Long, String> result = new LinkedHashMap<>();
    jdbc.query("SELECT id, dealer_full_name FROM activity_customer WHERE id IN (" + placeholders + ")",
        (rs, rowNum) -> Map.entry(rs.getLong(1), rs.getString(2)), customerIds.toArray())
        .forEach(entry -> result.put(entry.getKey(), entry.getValue()));
    return result;
  }

  public List<ImportIssue> issues(long taskId) {
    return jdbc.query("""
        SELECT id, severity, error_code, sheet_name, source_row_number, field_name, raw_value_masked, message, resolved_at
        FROM import_error WHERE import_task_id = ? AND resolved_at IS NULL ORDER BY severity, source_row_number, id
        """, (rs, rowNum) -> new ImportIssue(rs.getLong("id"), rs.getString("severity"), rs.getString("error_code"),
        rs.getString("sheet_name"), rs.getObject("source_row_number") == null ? null : rs.getInt("source_row_number"), rs.getString("field_name"),
        rs.getString("raw_value_masked"), rs.getString("message"), UtcTime.read(rs, "resolved_at")), taskId);
  }

  public void updateRow(long taskId, long rowId, Map<String, Object> changes, boolean deleted, long adminId) {
    ImportTask task = task(taskId);
    if (!"PREVIEW_READY".equals(task.status())) throw DomainException.conflict("IMPORT_NOT_EDITABLE", "当前导入任务不能编辑");
    transactions.executeWithoutResult(status -> {
      lockTask(taskId);
      List<MaterializeRow> currentRows = jdbc.query("""
          SELECT id, normalized_data_json, edited_data_json, sensitive_data_ciphertext, edited_sensitive_data_ciphertext
          FROM import_staging_row WHERE id = ? AND import_task_id = ? FOR UPDATE
          """, (rs, rowNum) -> new MaterializeRow(rs.getLong("id"), readMap(rs.getString("normalized_data_json")),
          readMap(rs.getString("edited_data_json")), rs.getBytes("sensitive_data_ciphertext"),
          rs.getBytes("edited_sensitive_data_ciphertext")), rowId, taskId);
      if (currentRows.size() != 1) throw DomainException.notFound("IMPORT_ROW_NOT_FOUND", "导入预览行不存在");

      MaterializeRow current = currentRows.getFirst();
      Map<String, Object> merged = current.effective();
      Map<String, Object> mergedSensitive = new LinkedHashMap<>(current.sensitive(crypto, json));
      Map<String, Object> safeChanges = new LinkedHashMap<>(changes == null ? Map.of() : changes);
      for (String field : List.of("dealerPhone", "confirmerPhone", "contactPhone")) {
        if (safeChanges.containsKey(field)) {
          String phone = CryptoService.normalizePhone(text(safeChanges.remove(field)));
          mergedSensitive.put(field, phone);
          if ("dealerPhone".equals(field)) merged.put("phoneMasked", CryptoService.maskPhone(phone));
          if ("confirmerPhone".equals(field)) merged.put("confirmerPhoneMasked", phone.isBlank() ? "" : CryptoService.maskPhone(phone));
          if ("contactPhone".equals(field)) merged.put("phoneMasked", phone.isBlank() ? "" : CryptoService.maskPhone(phone));
        }
      }
      merged.putAll(safeChanges);
      byte[] editedSensitive = mergedSensitive.isEmpty() ? null : crypto.encrypt(writeJson(mergedSensitive));
      jdbc.update("""
          UPDATE import_staging_row SET edited_data_json = ?, edited_sensitive_data_ciphertext = ?, is_deleted = ?,
            edited_by = ?, edited_at = UTC_TIMESTAMP(3) WHERE id = ? AND import_task_id = ?
          """, writeJson(merged), editedSensitive, deleted, adminId, rowId, taskId);
      workbookProcessor.revalidateTask(taskId, task.importType());
    });
  }

  public void deleteRows(long taskId, List<Long> rowIds, long adminId) {
    ImportTask task = task(taskId);
    if (!"PREVIEW_READY".equals(task.status())) throw DomainException.conflict("IMPORT_NOT_EDITABLE", "当前导入任务不能编辑");
    if (rowIds == null || rowIds.isEmpty()) throw DomainException.badRequest("IMPORT_ROWS_REQUIRED", "请选择要删除的导入预览行");

    List<Long> ids = rowIds.stream().filter(Objects::nonNull).distinct().sorted().toList();
    if (ids.size() != rowIds.size() || ids.stream().anyMatch(id -> id <= 0)) {
      throw DomainException.badRequest("IMPORT_ROW_IDS_INVALID", "导入预览行编号无效或重复");
    }

    transactions.executeWithoutResult(status -> {
      lockTask(taskId);
      String placeholders = String.join(", ", Collections.nCopies(ids.size(), "?"));
      List<Object> selectArgs = new ArrayList<>();
      selectArgs.add(taskId);
      selectArgs.addAll(ids);
      List<Long> existingIds = jdbc.queryForList("SELECT id FROM import_staging_row WHERE import_task_id = ? AND id IN (" + placeholders + ") ORDER BY id FOR UPDATE",
          Long.class, selectArgs.toArray());
      if (existingIds.size() != ids.size()) throw DomainException.notFound("IMPORT_ROW_NOT_FOUND", "部分导入预览行不存在");

      List<Object> updateArgs = new ArrayList<>();
      updateArgs.add(adminId);
      updateArgs.add(taskId);
      updateArgs.addAll(ids);
      jdbc.update("UPDATE import_staging_row SET is_deleted = TRUE, edited_by = ?, edited_at = UTC_TIMESTAMP(3) WHERE import_task_id = ? AND id IN (" + placeholders + ")",
          updateArgs.toArray());
      workbookProcessor.revalidateTask(taskId, task.importType());
    });
  }

  private void lockTask(long taskId) {
    jdbc.queryForObject("SELECT id FROM import_task WHERE id = ? FOR UPDATE", Long.class, taskId);
  }

  public ImportTask confirm(long taskId, long adminId, MultipartFile imageZip, String imageDecisionsJson,
                            Long attendanceWhitelistVersionId) {
    ImportTask task = task(taskId);
    boolean retryablePublishFailure = "FAILED".equals(task.status()) && "PUBLISH_FAILED".equals(task.failureCode());
    if (!"PREVIEW_READY".equals(task.status()) && !retryablePublishFailure) {
      throw DomainException.conflict("IMPORT_NOT_CONFIRMABLE", "当前任务不能确认发布");
    }
    workbookProcessor.revalidateTask(taskId, task.importType());
    Integer blocking = jdbc.queryForObject("""
        SELECT COUNT(*) FROM import_staging_row WHERE import_task_id = ? AND validation_status = 'BLOCKED' AND is_deleted = FALSE
        """, Integer.class, taskId);
    if (blocking != null && blocking > 0) throw DomainException.unprocessable("IMPORT_HAS_BLOCKING_ERRORS", "请先修正或删除阻塞行再确认导入");
    List<ProductImageDecision> imageDecisions = validateImageDecisions(taskId, task.importType(), imageDecisionsJson);
    Long matchBaseVersionId = null;
    if ("ATTENDANCE".equals(task.importType())) {
      matchBaseVersionId = attendanceMatching.currentWhitelistVersion(task.activityId());
      if (!Objects.equals(matchBaseVersionId, attendanceWhitelistVersionId)) {
        throw DomainException.conflict("ATTENDANCE_WHITELIST_VERSION_CHANGED", "当前白名单版本已变化，请刷新关联试算结果后再发布");
      }
    }
    if (!imageDecisions.isEmpty() && (imageZip == null || imageZip.isEmpty())) {
      throw DomainException.badRequest("IMAGE_DECISIONS_WITHOUT_ZIP", "提交图片匹配决定时必须同时上传本批次图片 ZIP");
    }
    Long auxiliaryFileId = null;
    if (imageZip != null && !imageZip.isEmpty()) {
      if (!"PRODUCT".equals(task.importType())) throw DomainException.badRequest("IMPORT_AUXILIARY_FILE_INVALID", "只有商品导入可以附带图片 ZIP");
      String filename = Objects.requireNonNullElse(imageZip.getOriginalFilename(), "product-images.zip");
      if (!filename.toLowerCase(Locale.ROOT).endsWith(".zip")) throw DomainException.badRequest("IMAGE_ZIP_INVALID", "请选择 ZIP 图片文件");
      if (imageZip.getSize() > 150L * 1024 * 1024) throw DomainException.badRequest("IMAGE_ZIP_TOO_LARGE", "图片 ZIP 不能超过 150MB");
      auxiliaryFileId = storage.save(task.activityId(), imageZip, "IMAGE_ARCHIVE", adminId).id();
    }
    int changed = jdbc.update("""
        UPDATE import_task SET status = 'CONFIRMING', auxiliary_file_id = ?, match_base_version_id = ?, image_decisions_json = ?, confirmed_by = ?, confirmed_at = UTC_TIMESTAMP(3),
          next_attempt_at = UTC_TIMESTAMP(3), failed_at = NULL, failure_code = NULL, failure_message = NULL,
          lease_owner = NULL, lease_expires_at = NULL
        WHERE id = ? AND (status = 'PREVIEW_READY' OR (status = 'FAILED' AND failure_code = 'PUBLISH_FAILED'))
        """, auxiliaryFileId, matchBaseVersionId, imageDecisions.isEmpty() ? null : writeJson(imageDecisions), adminId, taskId);
    if (changed != 1) throw DomainException.conflict("IMPORT_STATE_CHANGED", "导入任务状态已变化，请刷新后重试");
    return task(taskId);
  }

  private List<ProductImageDecision> validateImageDecisions(long taskId, String importType, String value) {
    if (value == null || value.isBlank()) return List.of();
    if (!"PRODUCT".equals(importType)) throw DomainException.badRequest("IMAGE_DECISIONS_NOT_ALLOWED", "只有商品导入可以提交图片匹配决定");
    List<ProductImageDecision> decisions;
    try { decisions = json.readValue(value, new TypeReference<List<ProductImageDecision>>() {}); }
    catch (Exception exception) { throw DomainException.badRequest("IMAGE_DECISIONS_INVALID", "图片匹配决定格式不正确"); }
    if (decisions.size() > 20_000) throw DomainException.badRequest("IMAGE_DECISIONS_TOO_MANY", "图片匹配决定数量过多");

    Map<Long, ProductImageIdentity> products = new LinkedHashMap<>();
    for (StagingRow row : rows(taskId, null)) {
      if (row.deleted()) continue;
      Map<String, Object> effective = new LinkedHashMap<>(row.normalizedData());
      if (row.editedData() != null) effective.putAll(row.editedData());
      products.put(row.id(), new ProductImageIdentity(text(effective.get("materialName"))));
    }
    Set<String> paths = new java.util.HashSet<>();
    Set<String> confirmedNames = new java.util.HashSet<>();
    for (ProductImageDecision decision : decisions) {
      String path = normalizeArchivePath(decision.entryPath());
      if (path.isBlank() || !paths.add(path)) throw DomainException.badRequest("IMAGE_DECISION_PATH_INVALID", "图片路径为空或重复");
      if (!Set.of("CONFIRMED", "PENDING", "UNMATCHED").contains(decision.status())) {
        throw DomainException.badRequest("IMAGE_DECISION_STATUS_INVALID", "图片匹配决定状态不正确");
      }
      List<Long> targetIds = decision.targetRowIds() == null ? List.of() : decision.targetRowIds().stream().filter(Objects::nonNull).distinct().toList();
      if ("CONFIRMED".equals(decision.status()) && targetIds.isEmpty()) {
        throw DomainException.badRequest("IMAGE_DECISION_TARGET_REQUIRED", "已确认图片必须选择商品");
      }
      if ("PENDING".equals(decision.status()) && targetIds.isEmpty()) {
        throw DomainException.badRequest("IMAGE_DECISION_CANDIDATE_REQUIRED", "待确认图片必须保留候选商品");
      }
      if ("UNMATCHED".equals(decision.status()) && !targetIds.isEmpty()) {
        throw DomainException.badRequest("IMAGE_DECISION_TARGET_NOT_ALLOWED", "未匹配图片不能携带候选商品");
      }
      if (targetIds.stream().anyMatch(id -> !products.containsKey(id))) {
        throw DomainException.badRequest("IMAGE_DECISION_TARGET_INVALID", "图片匹配目标不属于当前导入任务");
      }
      Set<String> names = targetIds.stream().map(products::get).map(ProductImageIdentity::materialName).map(ImportValues::normalize)
          .filter(name -> !name.isBlank()).collect(java.util.stream.Collectors.toSet());
      if ("CONFIRMED".equals(decision.status()) && names.isEmpty()) {
        throw DomainException.badRequest("IMAGE_DECISION_MATERIAL_NAME_REQUIRED", "商品缺少物料名称，不能确认图片");
      }
      if ("CONFIRMED".equals(decision.status()) && names.size() > 1) {
        throw DomainException.badRequest("IMAGE_DECISION_MULTIPLE_PRODUCTS", "一张图片不能确认给多个不同商品名称");
      }
      if ("CONFIRMED".equals(decision.status()) && names.size() == 1 && !confirmedNames.add(names.iterator().next())) {
        throw DomainException.badRequest("IMAGE_DECISION_MULTIPLE_IMAGES", "一个商品名称只能确认一张图片");
      }
    }
    return decisions.stream().map(decision -> new ProductImageDecision(normalizeArchivePath(decision.entryPath()), decision.status(),
        decision.targetRowIds() == null ? List.of() : decision.targetRowIds().stream().filter(Objects::nonNull).distinct().toList())).toList();
  }

  private static String normalizeArchivePath(String value) {
    return Objects.requireNonNullElse(value, "").replace('\\', '/').replaceAll("^/+", "").trim();
  }

  public void cancel(long taskId) {
    int changed = jdbc.update("UPDATE import_task SET status = 'CANCELLED' WHERE id = ? AND status IN ('UPLOADED','PARSING','PREVIEW_READY')", taskId);
    if (changed != 1) throw DomainException.conflict("IMPORT_NOT_CANCELLABLE", "当前任务不能取消");
  }


  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 1_000)
  public void processConfirmed() {
    List<Long> ids = jdbc.queryForList("""
        SELECT id FROM import_task WHERE status = 'CONFIRMING' AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP(3))
        ORDER BY confirmed_at LIMIT 1
        """, Long.class);
    if (ids.isEmpty()) return;
    long taskId = ids.getFirst();
    int claimed = jdbc.update("UPDATE import_task SET status = 'MATERIALIZING', attempt_count = attempt_count + 1, lease_owner = ?, lease_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE) WHERE id = ? AND status = 'CONFIRMING'",
        "worker-" + ProcessHandle.current().pid(), taskId);
    if (claimed != 1) return;
    try {
      transactions.executeWithoutResult(status -> publisher.publish(taskId));
    } catch (Exception exception) {
      jdbc.update("UPDATE import_task SET status = 'FAILED', failed_at = UTC_TIMESTAMP(3), failure_code = 'PUBLISH_FAILED', failure_message = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?",
          truncate(exception.getMessage(), 900), taskId);
    }
  }








  private long insertTask(long activityId, String type, StorageService.StoredFile file, long adminId) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var ps = connection.prepareStatement("""
          INSERT INTO import_task(activity_id, import_type, strategy, status, source_file_id, file_sha256, created_by)
          VALUES (?, ?, 'FULL_REPLACE', 'UPLOADED', ?, ?, ?)
          """, Statement.RETURN_GENERATED_KEYS);
      ps.setLong(1, activityId); ps.setString(2, type); ps.setLong(3, file.id()); ps.setBytes(4, file.sha256()); ps.setLong(5, adminId);
      return ps;
    }, keys);
    return keys.getKey().longValue();
  }







  private String writeJson(Object value) {
    try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }


  public record ImportTask(long id, long activityId, String importType, String status, String sourceFilename,
                           int inputCount, int addedCount, int updatedCount, int unchangedCount, int deactivatedCount,
                           int warningCount, int errorCount, String failureCode, String failureMessage,
                           long createdBy, long confirmedBy, Instant createdAt, Instant completedAt) {}
  public record StagingRow(long id, String sheetName, int sourceRowNumber, String diffType, String validationStatus,
                           Map<String, Object> normalizedData, Map<String, Object> editedData, boolean deleted) {}
  public record ImportIssue(long id, String severity, String code, String sheetName, Integer sourceRowNumber,
                            String fieldName, String rawValueMasked, String message, Instant resolvedAt) {}
  public record AttendanceMatchPreview(Long whitelistVersionId, Instant calculatedAt, int totalCount, int matchedCount,
                                       int pendingCount, int unmatchedCount, int eligibleCustomerCount,
                                       List<AttendanceMatchPreviewRow> rows) {}
  public record AttendanceMatchPreviewRow(long stagingRowId, Long activityCustomerId, String matchStatus,
                                          String matchMethod, String matchReasonCode, String matchedDealerName,
                                          boolean lotteryEligible) {}
  public record ProductImageDecision(String entryPath, String status, List<Long> targetRowIds) {}
  private record ProductImageIdentity(String materialName) {}
  private record AttendancePreviewDraft(long stagingRowId, AttendanceMatchingService.MatchResult match) {}
}
