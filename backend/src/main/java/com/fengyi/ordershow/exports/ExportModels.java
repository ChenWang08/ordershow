package com.fengyi.ordershow.exports;

import com.fengyi.ordershow.common.DomainException;
import java.time.Instant;
import java.util.List;

public final class ExportModels {
  private ExportModels() {}
  public record Filters(String status, String customerType, String keyword) {
    public Filters {
      status = clean(status); customerType = clean(customerType); keyword = clean(keyword);
      if (status != null && !List.of("SUBMITTED","WITHDRAWN","VOIDED").contains(status))
        throw DomainException.badRequest("EXPORT_FILTER_INVALID","订单状态无效");
      if (customerType != null && !List.of("GENERAL","SPECIAL","ALL").contains(customerType))
        throw DomainException.badRequest("EXPORT_FILTER_INVALID","客户类型无效");
      if (keyword != null && keyword.length() > 200) throw DomainException.badRequest("EXPORT_FILTER_INVALID","搜索内容最多200字");
    }
    private static String clean(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  }
  public record CreateRequest(String exportType, Filters filters) {}
  public record Activity(long id, String name, long generation) {}
  public record Task(long id, long activityId, String status, String stage, Filters filters,
      long orderCount, long detailCount, List<Long> sheetCounts, Instant snapshotAt, Instant createdAt,
      Instant completedAt, Instant expiresAt, String failureCode, String failureMessage,
      Long fileId, long generation, long createdBy, String leaseToken, boolean cancelRequested) {}
  public record Claim(Task task, String token) {}
  /** Only this view crosses the admin API; storage IDs and worker fencing tokens stay internal. */
  public record TaskView(long id, long activityId, String status, String stage, Filters filters,
      long orderCount, long detailCount, List<Long> sheetCounts, Instant snapshotAt, Instant createdAt,
      Instant completedAt, Instant expiresAt, String failureCode, String failureMessage, boolean cancelRequested) {
    public static TaskView of(Task task) {
      return new TaskView(task.id(),task.activityId(),task.status(),task.stage(),task.filters(),task.orderCount(),
          task.detailCount(),task.sheetCounts(),task.snapshotAt(),task.createdAt(),task.completedAt(),task.expiresAt(),
          task.failureCode(),task.failureMessage(),task.cancelRequested());
    }
  }
  public record Result(java.nio.file.Path zip, Instant snapshotAt, List<Long> counts) {}
}
