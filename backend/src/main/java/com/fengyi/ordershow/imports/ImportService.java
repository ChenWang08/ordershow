package com.fengyi.ordershow.imports;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.activity.ActivityRegionService;
import com.fengyi.ordershow.catalog.ProductService;
import com.fengyi.ordershow.customer.AttendanceMatchingService;
import com.fengyi.ordershow.security.CryptoService;
import com.fengyi.ordershow.storage.StorageService;
import java.math.BigDecimal;
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
  private final ProductService products;
  private final ActivityRegionService regions;

  public ImportService(JdbcTemplate jdbc, StorageService storage, CryptoService crypto,
                       ObjectMapper json, TransactionTemplate transactions, ImportWorkbookProcessor workbookProcessor,
                       AttendanceMatchingService attendanceMatching, ProductService products, ActivityRegionService regions) {
    this.jdbc = jdbc;
    this.storage = storage;
    this.crypto = crypto;
    this.json = json;
    this.transactions = transactions;
    this.workbookProcessor = workbookProcessor;
    this.attendanceMatching = attendanceMatching;
    this.products = products;
    this.regions = regions;
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
      cancelReplaceableTasks(activityId, importType, Long.MAX_VALUE);
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
    return jdbc.query("""
        SELECT t.*, f.original_filename FROM import_task t JOIN stored_file f ON f.id = t.source_file_id
        WHERE t.activity_id = ? ORDER BY t.created_at DESC
        """, this::mapTask, activityId);
  }

  public ImportTask task(long taskId) {
    List<ImportTask> rows = jdbc.query("""
        SELECT t.*, f.original_filename FROM import_task t JOIN stored_file f ON f.id = t.source_file_id WHERE t.id = ?
        """, this::mapTask, taskId);
    if (rows.size() != 1) throw DomainException.notFound("IMPORT_TASK_NOT_FOUND", "导入任务不存在");
    return rows.getFirst();
  }

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
        draft.match().reasonCode(), dealerNames.get(draft.match().customerId()), "MATCHED".equals(draft.match().status()))).toList();
    int matched = (int) previewRows.stream().filter(row -> "MATCHED".equals(row.matchStatus())).count();
    int pending = (int) previewRows.stream().filter(row -> "PENDING_CONFIRMATION".equals(row.matchStatus())).count();
    int unmatched = previewRows.size() - matched - pending;
    return new AttendanceMatchPreview(whitelistVersionId, Instant.now(), previewRows.size(), matched, pending, unmatched,
        matchedCustomerIds.size(), previewRows);
  }

  private List<MaterializeRow> materializeRows(long taskId) {
    return jdbc.query("""
        SELECT id, normalized_data_json, edited_data_json, sensitive_data_ciphertext, edited_sensitive_data_ciphertext
        FROM import_staging_row WHERE import_task_id = ? AND is_deleted = FALSE AND validation_status <> 'BLOCKED' ORDER BY id
        """, (rs, rowNum) -> new MaterializeRow(rs.getLong("id"), readMap(rs.getString("normalized_data_json")),
        readMap(rs.getString("edited_data_json")), rs.getBytes("sensitive_data_ciphertext"),
        rs.getBytes("edited_sensitive_data_ciphertext")), taskId);
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
        rs.getString("raw_value_masked"), rs.getString("message"), rs.getTimestamp("resolved_at") == null ? null : rs.getTimestamp("resolved_at").toInstant()), taskId);
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
      products.put(row.id(), new ProductImageIdentity(text(effective.get("materialCode")), text(effective.get("materialName"))));
    }
    Set<String> paths = new java.util.HashSet<>();
    Set<String> confirmedCodes = new java.util.HashSet<>();
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
      Set<String> codes = targetIds.stream().map(products::get).map(ProductImageIdentity::materialCode).map(ImportService::normalizeCode)
          .filter(code -> !code.isBlank()).collect(java.util.stream.Collectors.toSet());
      if ("CONFIRMED".equals(decision.status()) && codes.isEmpty()) {
        throw DomainException.badRequest("IMAGE_DECISION_MATERIAL_CODE_REQUIRED", "商品缺少物料代码，不能确认图片");
      }
      if ("CONFIRMED".equals(decision.status()) && codes.size() > 1) {
        throw DomainException.badRequest("IMAGE_DECISION_MULTIPLE_PRODUCTS", "一张图片不能确认给多个不同物料代码");
      }
      for (String code : codes) {
        Set<String> names = targetIds.stream().map(products::get)
            .filter(product -> normalizeCode(product.materialCode()).equals(code))
            .map(ProductImageIdentity::materialName).map(ImportService::normalize).filter(name -> !name.isBlank())
            .collect(java.util.stream.Collectors.toSet());
        if (names.size() > 1) throw DomainException.badRequest("IMAGE_DECISION_PRODUCT_NAME_CONFLICT", "同一物料代码存在不同商品名称，请先核对商品数据");
      }
      if ("CONFIRMED".equals(decision.status()) && codes.size() == 1 && !confirmedCodes.add(codes.iterator().next())) {
        throw DomainException.badRequest("IMAGE_DECISION_MULTIPLE_IMAGES", "一个物料代码只能确认一张图片");
      }
    }
    return decisions.stream().map(decision -> new ProductImageDecision(normalizeArchivePath(decision.entryPath()), decision.status(),
        decision.targetRowIds() == null ? List.of() : decision.targetRowIds().stream().filter(Objects::nonNull).distinct().toList())).toList();
  }

  private static String normalizeArchivePath(String value) {
    return Objects.requireNonNullElse(value, "").replace('\\', '/').replaceAll("^/+", "").trim();
  }

  private static String normalizeCode(String value) {
    return Objects.requireNonNullElse(value, "").replaceAll("\\s+", "").toLowerCase(Locale.CHINA);
  }


  public void cancel(long taskId) {
    int changed = jdbc.update("UPDATE import_task SET status = 'CANCELLED' WHERE id = ? AND status IN ('UPLOADED','PARSING','PREVIEW_READY')", taskId);
    if (changed != 1) throw DomainException.conflict("IMPORT_NOT_CANCELLABLE", "当前任务不能取消");
  }

  private int cancelReplaceableTasks(long activityId, String importType, long beforeTaskId) {
    return jdbc.update("""
        UPDATE import_task SET status = 'CANCELLED'
        WHERE activity_id = ? AND import_type = ? AND id < ?
          AND status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY')
        """, activityId, importType, beforeTaskId);
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
      transactions.executeWithoutResult(status -> publish(taskId));
    } catch (Exception exception) {
      jdbc.update("UPDATE import_task SET status = 'FAILED', failed_at = UTC_TIMESTAMP(3), failure_code = 'PUBLISH_FAILED', failure_message = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?",
          truncate(exception.getMessage(), 900), taskId);
    }
  }


  private void publish(long taskId) {
    ImportTask task = task(taskId);
    long activityId = task.activityId();
    long adminId = task.confirmedBy();
    jdbc.update("UPDATE import_task SET status = 'MATERIALIZING' WHERE id = ?", taskId);
    Long previous = jdbc.query("SELECT current_version_id FROM activity_data_binding WHERE activity_id = ? AND data_type = ? FOR UPDATE",
        rs -> {
          if (!rs.next()) return null;
          Object value = rs.getObject(1);
          return value == null ? null : ((Number) value).longValue();
        }, activityId, task.importType());
    int versionNo = jdbc.queryForObject("SELECT COALESCE(MAX(version_no), 0) + 1 FROM import_publish_version WHERE activity_id = ? AND data_type = ?", Integer.class, activityId, task.importType());
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var ps = connection.prepareStatement("""
          INSERT INTO import_publish_version(activity_id, data_type, version_no, source_import_task_id, status, created_by)
          VALUES (?, ?, ?, ?, 'BUILDING', ?)
          """, Statement.RETURN_GENERATED_KEYS);
      ps.setLong(1, activityId); ps.setString(2, task.importType()); ps.setInt(3, versionNo); ps.setLong(4, taskId); ps.setLong(5, adminId);
      return ps;
    }, keys);
    long versionId = keys.getKey().longValue();
    List<MaterializeRow> rows = materializeRows(taskId);
    switch (task.importType()) {
      case "PRODUCT" -> {
        materializeProducts(activityId, taskId, versionId, rows);
        Long imageArchiveId = jdbc.queryForObject("SELECT auxiliary_file_id FROM import_task WHERE id = ?", Long.class, taskId);
        String decisionsJson = jdbc.queryForObject("SELECT image_decisions_json FROM import_task WHERE id = ?", String.class, taskId);
        if (imageArchiveId != null) products.attachZipToVersion(activityId, versionId, imageArchiveId, adminId,
            zipDecisions(rows, readImageDecisions(decisionsJson)));
      }
      case "WHITELIST" -> materializeWhitelist(activityId, taskId, versionId, rows);
      case "ATTENDANCE" -> {
        Long expectedWhitelistVersion = jdbc.queryForObject("SELECT match_base_version_id FROM import_task WHERE id = ?", Long.class, taskId);
        if (!Objects.equals(expectedWhitelistVersion, attendanceMatching.currentWhitelistVersion(activityId))) {
          throw DomainException.conflict("ATTENDANCE_WHITELIST_VERSION_CHANGED", "当前白名单版本已变化，请重新试算到场关联后再发布");
        }
        materializeAttendance(activityId, taskId, versionId, rows, adminId);
      }
      default -> throw new IllegalStateException("Unsupported import type " + task.importType());
    }
    jdbc.update("UPDATE import_publish_version SET status = 'READY', row_count = ?, ready_at = UTC_TIMESTAMP(3) WHERE id = ?", rows.size(), versionId);
    jdbc.update("UPDATE import_task SET status = 'READY_TO_PUBLISH' WHERE id = ?", taskId);
    jdbc.update("UPDATE import_task SET status = 'PUBLISHING' WHERE id = ?", taskId);
    jdbc.update("""
        INSERT INTO activity_data_binding(activity_id, data_type, current_version_id, lock_version, updated_by)
        VALUES (?, ?, ?, 0, ?)
        ON DUPLICATE KEY UPDATE current_version_id = VALUES(current_version_id), lock_version = lock_version + 1, updated_by = VALUES(updated_by)
        """, activityId, task.importType(), versionId, adminId);
    if ("WHITELIST".equals(task.importType())) attendanceMatching.reassociateCurrentAttendance(activityId, versionId);
    if (previous != null && previous > 0) jdbc.update("UPDATE import_publish_version SET status = 'RETIRED', retired_at = UTC_TIMESTAMP(3) WHERE id = ?", previous);
    jdbc.update("UPDATE import_publish_version SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3) WHERE id = ?", versionId);
    jdbc.update("UPDATE import_task SET status = 'COMPLETED', published_version_id = ?, completed_at = UTC_TIMESTAMP(3), lease_owner = NULL, lease_expires_at = NULL WHERE id = ?", versionId, taskId);
    cancelReplaceableTasks(activityId, task.importType(), taskId);
  }

  private List<ProductImageDecision> readImageDecisions(String value) {
    if (value == null || value.isBlank()) return List.of();
    try { return json.readValue(value, new TypeReference<List<ProductImageDecision>>() {}); }
    catch (Exception exception) { throw new IllegalStateException("Stored image decisions are invalid", exception); }
  }

  private List<ProductService.ZipDecision> zipDecisions(List<MaterializeRow> rows, List<ProductImageDecision> decisions) {
    Map<Long, MaterializeRow> byId = rows.stream().collect(java.util.stream.Collectors.toMap(MaterializeRow::id, row -> row));
    return decisions.stream().map(decision -> new ProductService.ZipDecision(decision.entryPath(), decision.status(),
        decision.targetRowIds().stream().map(byId::get).filter(Objects::nonNull)
            .map(row -> text(row.effective().get("materialCode"))).filter(code -> !code.isBlank()).distinct().toList())).toList();
  }

  private void materializeProducts(long activityId, long taskId, long versionId, List<MaterializeRow> rows) {
    int sort = 0;
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      String name = text(data.get("materialName"));
      BigDecimal casePrice = decimal(data.get("casePrice"));
      BigDecimal factor = decimal(data.get("tonCaseFactor"));
      boolean visible = !name.isBlank();
      boolean orderable = visible && casePrice != null && casePrice.signum() > 0;
      String status = optionalProductMissing(data) ? "INCOMPLETE" : "ACTIVE";
      String businessKey = productKey(data);
      jdbc.update("""
          INSERT INTO activity_product(activity_id, customer_type, rebate_status, business_key, material_code, material_name,
            category_name, product_line, brand_name, variety_name, specification, case_pack, bottle_price, case_price,
            ton_case_factor, is_gift_box, is_branch_customized, is_visible, is_orderable, sort_no, data_status,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, activityId, text(data.get("customerType")), text(data.get("rebateStatus")), businessKey,
          nullableText(data.get("materialCode")), name, nullableText(data.get("categoryName")), nullableText(data.get("productLine")),
          nullableText(data.get("brandName")), nullableText(data.get("varietyName")), nullableText(data.get("specification")),
          nullableText(data.get("casePack")), decimal(data.get("bottlePrice")), casePrice, factor, bool(data.get("giftBox")),
          !text(data.get("branchScope")).isBlank(), visible, orderable, ++sort, status, taskId, versionId);
      Long productId = jdbc.queryForObject("SELECT id FROM activity_product WHERE activity_id = ? AND data_version_id = ? AND business_key = ?", Long.class, activityId, versionId, businessKey);
      if (productId != null) for (String branch : text(data.get("branchScope")).split("[，,、]")) {
        if (!branch.isBlank()) jdbc.update("INSERT INTO activity_product_branch_scope(activity_product_id, branch_name, normalized_branch_name) VALUES (?, ?, ?)", productId, branch.trim(), normalize(branch));
      }
      Long tierMinQuantity = integer(data.get("priceTierMinQuantity"));
      BigDecimal tierCasePrice = decimal(data.get("priceTierCasePrice"));
      String tierPricingMode = text(data.get("priceTierPricingMode"));
      if (tierPricingMode.isBlank()) tierPricingMode = "WHOLE_ORDER";
      if (productId != null && tierMinQuantity != null && tierCasePrice != null) {
        jdbc.update("INSERT INTO activity_product_price_tier(activity_product_id, min_quantity, case_price, pricing_mode) VALUES (?, ?, ?, ?)",
            productId, tierMinQuantity, tierCasePrice, tierPricingMode);
      }
    }
  }

  private void materializeWhitelist(long activityId, long taskId, long versionId, List<MaterializeRow> rows) {
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      Map<String, Object> sensitive = row.sensitive(crypto, json);
      String customerType = text(data.get("customerType"));
      String fullName = text(data.get("dealerFullName"));
      String normalizedName = normalize(fullName);
      jdbc.update("""
          INSERT INTO customer(customer_type, dealer_full_name, normalized_dealer_full_name) VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE dealer_full_name = VALUES(dealer_full_name), updated_at = UTC_TIMESTAMP(3)
          """, customerType, fullName, normalizedName);
      Long customerId = jdbc.queryForObject("SELECT id FROM customer WHERE customer_type = ? AND normalized_dealer_full_name = ?", Long.class, customerType, normalizedName);
      String phone = text(sensitive.get("dealerPhone"));
      String confirmerPhone = text(sensitive.get("confirmerPhone"));
      jdbc.update("""
          INSERT INTO activity_customer(activity_id, customer_id, customer_type, region_code, branch_name, normalized_branch_name,
            dealer_short_name, dealer_full_name, dealer_category, contact_name, phone_ciphertext, phone_lookup_hash, phone_masked,
            confirmer_name, confirmer_phone_ciphertext, confirmer_phone_masked, excel_sequence, is_active,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)
          """, activityId, customerId, customerType,
          "GENERAL".equals(customerType) ? regions.resolveCode(activityId, text(data.get("regionName"))) : null,
          nullableText(data.get("branchName")),
          normalize(text(data.get("branchName"))), nullableText(data.get("dealerShortName")), fullName, nullableText(data.get("dealerCategory")),
          nullableText(data.get("contactName")), crypto.encrypt(phone), crypto.lookupHash(phone), CryptoService.maskPhone(phone),
          nullableText(data.get("confirmerName")), confirmerPhone.isBlank() ? null : crypto.encrypt(confirmerPhone),
          confirmerPhone.isBlank() ? null : CryptoService.maskPhone(confirmerPhone), intValue(data.get("sequence"), 0), taskId, versionId);
    }
  }

  private void materializeAttendance(long activityId, long taskId, long versionId, List<MaterializeRow> rows, long adminId) {
    Long whitelistVersion = attendanceMatching.currentWhitelistVersion(activityId);
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      String phone = text(row.sensitive(crypto, json).get("contactPhone"));
      AttendanceMatchingService.MatchResult match = attendanceMatching.match(activityId, whitelistVersion,
          text(data.get("participantType")), text(data.get("branchName")), text(data.get("dealerFullName")));
      jdbc.update("""
          INSERT INTO activity_attendee(activity_id, activity_customer_id, match_status, match_method, match_reason_code,
            participant_name, gender, participant_type,
            dealer_name_snapshot, branch_name_snapshot, phone_ciphertext, phone_lookup_hash, phone_masked,
            source_import_task_id, data_version_id, is_active, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
          """, activityId, match.customerId(), match.status(), match.method(), match.reasonCode(),
          nullableText(data.get("participantName")), nullableText(data.get("gender")),
          nullableText(data.get("participantType")), text(data.get("dealerFullName")), nullableText(data.get("branchName")),
          phone.isBlank() ? null : crypto.encrypt(phone), phone.matches("1\\d{10}") ? crypto.lookupHash(phone) : null,
          phone.isBlank() ? null : CryptoService.maskPhone(phone), taskId, versionId, adminId);
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


  private static boolean optionalProductMissing(Map<String, Object> data) {
    return List.of("materialCode", "productLine", "specification", "casePack", "casePrice", "tonCaseFactor")
        .stream().anyMatch(key -> text(data.get(key)).isBlank());
  }

  private static String productKey(Map<String, Object> data) {
    String prefix = text(data.get("customerType")) + ":" + text(data.get("rebateStatus")) + ":";
    String code = normalize(text(data.get("materialCode")));
    return prefix + (!code.isBlank() ? code : normalize(text(data.get("materialName"))));
  }

  private static BigDecimal decimal(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")); }
    catch (Exception ignored) { return null; }
  }

  private static Long integer(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")).longValueExact(); }
    catch (Exception ignored) { return null; }
  }

  private static int intValue(Object value, int fallback) {
    try { return Integer.parseInt(text(value)); } catch (Exception ignored) { return fallback; }
  }
  private static boolean bool(Object value) { return value instanceof Boolean b ? b : Boolean.parseBoolean(text(value)); }
  private static String nullableText(Object value) { String text = text(value); return text.isBlank() ? null : text; }
  private static String text(Object value) { return value == null ? "" : value.toString().trim(); }
  private static String normalize(String value) { return text(value).toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", ""); }
  private static String truncate(String value, int max) { String safe = Objects.requireNonNullElse(value, ""); return safe.length() <= max ? safe : safe.substring(0, max); }

  private String writeJson(Object value) {
    try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  private ImportTask mapTask(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new ImportTask(rs.getLong("id"), rs.getLong("activity_id"), rs.getString("import_type"), rs.getString("status"),
        rs.getString("original_filename"), rs.getInt("input_count"), rs.getInt("added_count"), rs.getInt("updated_count"),
        rs.getInt("unchanged_count"), rs.getInt("deactivated_count"), rs.getInt("warning_count"), rs.getInt("error_count"),
        rs.getString("failure_code"), rs.getString("failure_message"), rs.getLong("created_by"),
        rs.getObject("confirmed_by") == null ? 0 : rs.getLong("confirmed_by"), rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant());
  }

  private record MaterializeRow(long id, Map<String, Object> normalized, Map<String, Object> edited,
                                byte[] sensitiveBytes, byte[] editedSensitiveBytes) {
    Map<String, Object> effective() { Map<String, Object> result = new LinkedHashMap<>(normalized); if (edited != null) result.putAll(edited); return result; }
    Map<String, Object> sensitive(CryptoService crypto, ObjectMapper json) {
      byte[] bytes = editedSensitiveBytes != null ? editedSensitiveBytes : sensitiveBytes;
      if (bytes == null) return Map.of();
      try { return json.readValue(crypto.decrypt(bytes), new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
    }
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
  private record ProductImageIdentity(String materialCode, String materialName) {}
  private record AttendancePreviewDraft(long stagingRowId, AttendanceMatchingService.MatchResult match) {}
}
