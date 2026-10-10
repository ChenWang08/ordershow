package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportWorkbookRules.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.security.CryptoService;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;


final class ImportPreviewValidator {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ObjectMapper json;
  private final ImportStagingWriter staging;
  ImportPreviewValidator(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json, ImportStagingWriter staging) {
    this.jdbc = jdbc; this.crypto = crypto; this.json = json; this.staging = staging;
  }
  void revalidateTask(long taskId, String importType) {
    List<ReviewRow> rows = jdbc.query("""
        SELECT id, sheet_name, source_row_number, normalized_data_json, edited_data_json,
          sensitive_data_ciphertext, edited_sensitive_data_ciphertext, is_deleted
        FROM import_staging_row WHERE import_task_id = ? ORDER BY id
        """, (rs, rowNum) -> {
      MaterializeRow values = new MaterializeRow(rs.getLong("id"), readMap(rs.getString("normalized_data_json")),
          readMap(rs.getString("edited_data_json")), rs.getBytes("sensitive_data_ciphertext"),
          rs.getBytes("edited_sensitive_data_ciphertext"));
      return new ReviewRow(values.id(), rs.getString("sheet_name"), rs.getInt("source_row_number"),
          values.effective(), values.sensitive(crypto, json), rs.getBoolean("is_deleted"));
    }, taskId);

    Map<String, Integer> whitelistPhones = new HashMap<>();
    Map<String, Integer> whitelistNames = new HashMap<>();
    boolean whitelistHasAll = false;
    boolean whitelistHasTyped = false;
    if ("WHITELIST".equals(importType)) {
      for (ReviewRow row : rows) {
        if (row.deleted()) continue;
        String phone = text(row.sensitive().get("dealerPhone"));
        String customerType = text(row.data().get("customerType"));
        if ("ALL".equals(customerType)) whitelistHasAll = true;
        else if ("GENERAL".equals(customerType) || "SPECIAL".equals(customerType)) whitelistHasTyped = true;
        if (!phone.isBlank()) whitelistPhones.merge(customerType + "|" + phone, 1, Integer::sum);
        String name = normalize(text(row.data().get("dealerFullName")));
        String branch = normalize(text(row.data().get("branchName")));
        if (!name.isBlank()) whitelistNames.merge(customerType + "|" + name + "|" + branch, 1, Integer::sum);
      }
    }
    boolean whitelistTypeMixed = whitelistHasAll && whitelistHasTyped;
    Set<Long> duplicateProductRowIds = new HashSet<>();
    if ("PRODUCT".equals(importType)) {
      List<ReviewRow> activeProducts = rows.stream().filter(row -> !row.deleted()).toList();
      List<Map<String, Object>> productData = activeProducts.stream().map(ReviewRow::data).toList();
      Set<Integer> duplicateIndexes = duplicateProductRowIndexes(productData);
      for (int index = 0; index < activeProducts.size(); index++) {
        if (duplicateIndexes.contains(index)) duplicateProductRowIds.add(activeProducts.get(index).id());
      }
    }

    jdbc.update("UPDATE import_error SET resolved_at = UTC_TIMESTAMP(3) WHERE import_task_id = ? AND resolved_at IS NULL", taskId);
    int warnings = 0;
    int blocking = 0;
    int added = 0;
    for (ReviewRow row : rows) {
      String validation = "VALID";
      String diffType = "ADDED";
      String rowKey = null;
      if (!row.deleted()) {
        if ("PRODUCT".equals(importType)) {
          rowKey = productKey(row.data());
          boolean duplicateIdentity = duplicateProductRowIds.contains(row.id());
          boolean invalidCustomerType = bool(row.data().get("customerTypeInvalid"));
          boolean invalidRebateStatus = bool(row.data().get("rebateStatusInvalid"));
          if (text(row.data().get("materialName")).isBlank()) {
            validation = "BLOCKED"; blocking++;
            staging.issue(taskId, "BLOCKING", "MATERIAL_NAME_REQUIRED", row.sheet(), row.rowNo(), "materialName", null, "物料名称不能为空");
          } else if (invalidCustomerType) {
            validation = "BLOCKED"; blocking++;
            staging.issue(taskId, "BLOCKING", "PRODUCT_CUSTOMER_TYPE_INVALID", row.sheet(), row.rowNo(), "customerType", null,
                "客户类型只允许“综合”“特渠”或空");
          } else if (invalidRebateStatus) {
            validation = "BLOCKED"; blocking++;
            staging.issue(taskId, "BLOCKING", "PRODUCT_REBATE_INVALID", row.sheet(), row.rowNo(), "rebateStatus", null,
                "是否返利只允许“是”“否”或空");
          } else if (duplicateIdentity) {
            validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
            staging.issue(taskId, "BLOCKING", "PRODUCT_NAME_DUPLICATE", row.sheet(), row.rowNo(), "materialName",
                text(row.data().get("materialName")), "同一客户类型、同一返利类型下商品名称与物料代码组合重复；任一物料代码为空时按名称判重，请编辑或删除重复行");
          } else if (priceTierError(row.data()) != null) {
            validation = "BLOCKED"; blocking++;
            staging.issue(taskId, "BLOCKING", "PRODUCT_PRICE_TIER_INVALID", row.sheet(), row.rowNo(), "priceTier",
                null, priceTierError(row.data()));
          } else if (optionalProductMissing(row.data())) {
            validation = "WARNING"; warnings++;
            staging.issue(taskId, "WARNING", "PRODUCT_INCOMPLETE", row.sheet(), row.rowNo(), null, null,
                "元/箱或吨箱转换系数缺失或无效；无有效箱价不可下单，缺系数按 0 吨计入");
          }
        } else if ("WHITELIST".equals(importType)) {
          String phone = text(row.sensitive().get("dealerPhone"));
          String customerType = text(row.data().get("customerType"));
          boolean invalidCustomerType = bool(row.data().get("customerTypeInvalid")) || !Set.of("GENERAL", "SPECIAL", "ALL").contains(customerType);
          boolean invalid = !phone.matches("1\\d{10}") || text(row.data().get("dealerFullName")).isBlank();
          boolean duplicatePhone = !phone.isBlank() && whitelistPhones.getOrDefault(customerType + "|" + phone, 0) > 1;
          boolean duplicateName = whitelistNames.getOrDefault(customerType + "|" + normalize(text(row.data().get("dealerFullName"))) + "|" + normalize(text(row.data().get("branchName"))), 0) > 1;
          if (invalidCustomerType || whitelistTypeMixed || invalid || duplicatePhone || duplicateName) {
            validation = "BLOCKED"; blocking++;
            if (duplicateName) diffType = "PENDING_CONFIRMATION";
            String code = whitelistTypeMixed ? "WHITELIST_CUSTOMER_TYPE_MIXED" : invalidCustomerType ? "WHITELIST_CUSTOMER_TYPE_INVALID"
                : duplicateName ? "DUPLICATE_DEALER_NAME" : duplicatePhone ? "DUPLICATE_PHONE" : "WHITELIST_ROW_INVALID";
            String message = whitelistTypeMixed ? "客户类型不能部分填写、部分为空；请保证整张表全部填写或全部留空"
                : invalidCustomerType ? "客户类型只允许“综合客户”“特渠专业客户”或空"
                : duplicateName ? "同一客户类型、同一分公司下经销商全称重复；请核实后编辑或删除重复行"
                : duplicatePhone ? "同一客户类型下手机号重复；不同客户类型可以使用相同手机号" : "经销商全称或手机号无效";
            staging.issue(taskId, "BLOCKING", code, row.sheet(), row.rowNo(), whitelistTypeMixed || invalidCustomerType ? "customerType" : invalid ? "dealerPhone" : duplicateName ? "dealerFullName" : null,
                invalid || duplicatePhone ? CryptoService.maskPhone(phone) : text(row.data().get("dealerFullName")), message);
          }
        } else if ("ATTENDANCE".equals(importType)) {
          String phone = text(row.sensitive().get("contactPhone"));
          if (text(row.data().get("dealerFullName")).isBlank()) {
            validation = "BLOCKED"; blocking++;
            staging.issue(taskId, "BLOCKING", "DEALER_NAME_REQUIRED", row.sheet(), row.rowNo(), "dealerFullName", null, "经销商名称不能为空");
          } else if (!phone.matches("1\\d{10}")) {
            validation = "WARNING"; warnings++;
            staging.issue(taskId, "WARNING", "ATTENDANCE_PHONE_INVALID", row.sheet(), row.rowNo(), "contactPhone",
                CryptoService.maskPhone(phone), "电话为空或格式异常，记录可导入，并改用经销商全称或简称尝试关联白名单");
          }
        }
        if (!"BLOCKED".equals(validation) && "ADDED".equals(diffType)) added++;
      }
      if (rowKey == null) jdbc.update("UPDATE import_staging_row SET validation_status = ?, diff_type = ? WHERE id = ?", validation, diffType, row.id());
      else jdbc.update("UPDATE import_staging_row SET validation_status = ?, diff_type = ?, row_key = ? WHERE id = ?",
          validation, diffType, truncate(rowKey, 500), row.id());
    }
    jdbc.update("UPDATE import_task SET added_count = ?, warning_count = ?, error_count = ? WHERE id = ?", added, warnings, blocking, taskId);
  }

  private Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  private record ReviewRow(long id, String sheet, int rowNo, Map<String, Object> data,
                           Map<String, Object> sensitive, boolean deleted) {}
}
