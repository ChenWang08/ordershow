package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportValues.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import com.fengyi.ordershow.imports.ImportService.ImportTask;
import com.fengyi.ordershow.imports.ImportService.ProductImageDecision;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.catalog.ProductService;
import com.fengyi.ordershow.customer.AttendanceMatchingService;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;


/** Runs inside ImportService's existing publication transaction. */
@Service
public class ImportPublisher {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ImportTaskRepository tasks;
  private final ProductImportWriter productWriter;
  private final WhitelistImportWriter whitelistWriter;
  private final AttendanceImportWriter attendanceWriter;
  private final AttendanceMatchingService attendanceMatching;
  private final ProductService products;
  public ImportPublisher(JdbcTemplate jdbc, ObjectMapper json, ImportTaskRepository tasks,
      ProductImportWriter productWriter, WhitelistImportWriter whitelistWriter, AttendanceImportWriter attendanceWriter,
      AttendanceMatchingService attendanceMatching, ProductService products) {
    this.jdbc = jdbc; this.json = json; this.tasks = tasks; this.productWriter = productWriter;
    this.whitelistWriter = whitelistWriter; this.attendanceWriter = attendanceWriter;
    this.attendanceMatching = attendanceMatching; this.products = products;
  }
  void publish(long taskId) {
    // Locking reads before the activity lock avoid creating an old REPEATABLE_READ snapshot
    // while another publication is committing a new catalog version for this activity.
    long activityId = jdbc.queryForObject("SELECT activity_id FROM import_task WHERE id = ? FOR UPDATE", Long.class, taskId);
    jdbc.queryForList("SELECT id FROM activity WHERE id = ? FOR UPDATE", activityId);
    ImportTask task = tasks.task(taskId);
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
    List<MaterializeRow> rows = tasks.materializeRows(taskId);
    switch (task.importType()) {
      case "PRODUCT" -> {
        productWriter.write(activityId, taskId, versionId, rows);
        new com.fengyi.ordershow.catalog.ProductDealerScopeService(jdbc).inherit(activityId, versionId);
        Long imageArchiveId = jdbc.queryForObject("SELECT auxiliary_file_id FROM import_task WHERE id = ?", Long.class, taskId);
        String decisionsJson = jdbc.queryForObject("SELECT image_decisions_json FROM import_task WHERE id = ?", String.class, taskId);
        if (imageArchiveId != null) products.attachZipToVersion(activityId, versionId, imageArchiveId, adminId,
            zipDecisions(rows, readImageDecisions(decisionsJson)));
      }
      case "WHITELIST" -> whitelistWriter.write(activityId, taskId, versionId, rows);
      case "ATTENDANCE" -> {
        Long expectedWhitelistVersion = jdbc.queryForObject("SELECT match_base_version_id FROM import_task WHERE id = ?", Long.class, taskId);
        if (!Objects.equals(expectedWhitelistVersion, attendanceMatching.currentWhitelistVersion(activityId))) {
          throw DomainException.conflict("ATTENDANCE_WHITELIST_VERSION_CHANGED", "当前白名单版本已变化，请重新试算到场关联后再发布");
        }
        attendanceWriter.write(activityId, taskId, versionId, rows, adminId);
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
    tasks.cancelReplaceableTasks(activityId, task.importType(), taskId);
    if (List.of("PRODUCT", "WHITELIST").contains(task.importType())) {
      com.fengyi.ordershow.catalog.ProductCatalogChanges.all(jdbc, activityId);
    }
    if ("WHITELIST".equals(task.importType())) {
      com.fengyi.ordershow.activity.ActivityInfoChanges.record(jdbc, activityId);
    }
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
            .map(row -> text(row.effective().get("materialName"))).filter(name -> !name.isBlank()).distinct().toList())).toList();
  }
}
