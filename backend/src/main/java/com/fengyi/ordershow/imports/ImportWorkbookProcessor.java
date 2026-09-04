package com.fengyi.ordershow.imports;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
final class ImportWorkbookProcessor {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ObjectMapper json;
  private final DataFormatter formatter = new DataFormatter(Locale.CHINA);

  ImportWorkbookProcessor(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json) {
    this.jdbc = jdbc;
    this.crypto = crypto;
    this.json = json;
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
    Map<String, Integer> productNameCounts = new HashMap<>();
    if ("PRODUCT".equals(importType)) {
      for (ReviewRow row : rows) {
        if (row.deleted()) continue;
        String nameKey = productNameMatchKey(row.data());
        if (!nameKey.endsWith(":")) productNameCounts.merge(nameKey, 1, Integer::sum);
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
          String nameKey = productNameMatchKey(row.data());
          boolean duplicateName = !nameKey.endsWith(":") && productNameCounts.getOrDefault(nameKey, 0) > 1;
          boolean invalidCustomerType = bool(row.data().get("customerTypeInvalid"));
          boolean invalidRebateStatus = bool(row.data().get("rebateStatusInvalid"));
          if (text(row.data().get("materialName")).isBlank()) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "MATERIAL_NAME_REQUIRED", row.sheet(), row.rowNo(), "materialName", null, "物料名称不能为空");
          } else if (invalidCustomerType) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_CUSTOMER_TYPE_INVALID", row.sheet(), row.rowNo(), "customerType", null,
                "客户类型只允许“综合”“特渠”或空");
          } else if (invalidRebateStatus) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_REBATE_INVALID", row.sheet(), row.rowNo(), "rebateStatus", null,
                "是否返利只允许“是”“否”或空");
          } else if (duplicateName) {
            validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_NAME_DUPLICATE", row.sheet(), row.rowNo(), "materialName",
                text(row.data().get("materialName")), "同一客户类型、同一返利类型下商品名称重复，请编辑或删除重复行");
          } else if (priceTierError(row.data()) != null) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_PRICE_TIER_INVALID", row.sheet(), row.rowNo(), "priceTier",
                null, priceTierError(row.data()));
          } else if (optionalProductMissing(row.data())) {
            validation = "WARNING"; warnings++;
            issue(taskId, "WARNING", "PRODUCT_INCOMPLETE", row.sheet(), row.rowNo(), null, null,
                "商品信息不完整；仍会进入 H5，价格缺失时不可下单，其他缺失字段不展示");
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
            issue(taskId, "BLOCKING", code, row.sheet(), row.rowNo(), whitelistTypeMixed || invalidCustomerType ? "customerType" : invalid ? "dealerPhone" : duplicateName ? "dealerFullName" : null,
                invalid || duplicatePhone ? CryptoService.maskPhone(phone) : text(row.data().get("dealerFullName")), message);
          }
        } else if ("ATTENDANCE".equals(importType)) {
          String phone = text(row.sensitive().get("contactPhone"));
          if (text(row.data().get("dealerFullName")).isBlank()) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "DEALER_NAME_REQUIRED", row.sheet(), row.rowNo(), "dealerFullName", null, "经销商名称不能为空");
          } else if (!phone.matches("1\\d{10}")) {
            validation = "WARNING"; warnings++;
            issue(taskId, "WARNING", "ATTENDANCE_PHONE_INVALID", row.sheet(), row.rowNo(), "contactPhone",
                CryptoService.maskPhone(phone), "电话为空或格式异常，记录可导入，并改用经销商全称或简称尝试关联白名单");
          }
        }
        if (!"BLOCKED".equals(validation) && "ADDED".equals(diffType)) added++;
      }
      if (rowKey == null) jdbc.update("UPDATE import_staging_row SET validation_status = ?, diff_type = ? WHERE id = ?", validation, diffType, row.id());
      else jdbc.update("UPDATE import_staging_row SET validation_status = ?, diff_type = ?, row_key = ? WHERE id = ?",
          validation, diffType, truncate(rowKey, 250), row.id());
    }
    jdbc.update("UPDATE import_task SET added_count = ?, warning_count = ?, error_count = ? WHERE id = ?", added, warnings, blocking, taskId);
  }

  ParseSummary parse(long taskId, String importType, byte[] bytes) {
    try (Workbook workbook = WorkbookFactory.create(new ByteArrayInputStream(bytes))) {
      return switch (importType) {
        case "PRODUCT" -> parseProducts(taskId, workbook);
        case "WHITELIST" -> parseWhitelist(taskId, workbook);
        case "ATTENDANCE" -> parseAttendance(taskId, workbook);
        default -> throw DomainException.badRequest("IMPORT_TYPE_INVALID", "不支持的导入类型");
      };
    } catch (DomainException exception) {
      throw exception;
    } catch (Exception exception) {
      throw DomainException.unprocessable("IMPORT_PARSE_FAILED", exception.getMessage());
    }
  }

  private ParseSummary parseProducts(long taskId, Workbook workbook) {
    List<String> headers = List.of("客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明");
    List<ParsedProductRow> parsed = new ArrayList<>();
    List<Sheet> nonEmptySheets = new ArrayList<>();
    for (int index = 0; index < workbook.getNumberOfSheets(); index++) {
      Sheet candidate = workbook.getSheetAt(index);
      if (hasData(candidate)) nonEmptySheets.add(candidate);
    }
    if (nonEmptySheets.isEmpty()) throw DomainException.unprocessable("PRODUCT_SHEET_EMPTY", "商品 Excel 中没有找到非空 Sheet");
    if (nonEmptySheets.size() > 1) {
      throw DomainException.unprocessable("PRODUCT_SHEET_COUNT_INVALID", "商品 Excel 只允许一个非空 Sheet，当前发现：" +
          nonEmptySheets.stream().map(Sheet::getSheetName).collect(Collectors.joining("、")));
    }
    Sheet sheet = nonEmptySheets.getFirst();
    int headerRow = findHeader(sheet, "物料名称", 30);
    Map<String, Integer> indexes = indexes(sheet.getRow(headerRow), headers);
    requireHeaders(sheet.getSheetName(), indexes, headers);
    for (int rowNo = headerRow + 1; rowNo <= Math.min(sheet.getLastRowNum(), headerRow + 20_000); rowNo++) {
      Row row = sheet.getRow(rowNo);
      if (blank(row)) continue;
      String customerTypeRaw = cell(row, indexes.get("客户类型"));
      String rebateRaw = cell(row, indexes.get("是否返利"));
      String customerType = productCustomerType(customerTypeRaw);
      String rebateStatus = productRebateStatus(rebateRaw);
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("customerType", customerType);
      data.put("rebateStatus", rebateStatus);
      data.put("customerTypeInvalid", !customerTypeRaw.isBlank() && "ALL".equals(customerType));
      data.put("rebateStatusInvalid", !rebateRaw.isBlank() && "ALL".equals(rebateStatus));
      data.put("categoryName", cell(row, indexes.get("产品大类")));
      data.put("productLine", cell(row, indexes.get("产品线")));
      data.put("materialCode", cell(row, indexes.get("物料代码")));
      data.put("materialName", cell(row, indexes.get("物料名称")));
      data.put("description", cell(row, indexes.get("产品说明")));
      data.put("brandName", cell(row, indexes.get("品牌")));
      data.put("varietyName", cell(row, indexes.get("品种")));
      data.put("specification", cell(row, indexes.get("规格")));
      data.put("casePack", cell(row, indexes.get("箱规")));
      data.put("bottlePrice", decimalText(cell(row, indexes.get("元/瓶"))));
      data.put("casePrice", decimalText(cell(row, indexes.get("元/箱"))));
      data.put("tonCaseFactor", positiveDecimalText(cell(row, indexes.get("吨箱转换系数"))));
      data.put("giftBox", "是".equals(cell(row, indexes.get("是否为标品礼盒"))));
      data.put("branchScope", cell(row, indexes.get("分公司定制品")));
      parsed.add(new ParsedProductRow(sheet.getSheetName(), rowNo + 1, data));
    }
    if (parsed.isEmpty()) throw DomainException.unprocessable("PRODUCT_EMPTY", "Excel 中没有找到商品数据行");

    Map<String, Integer> nameCounts = new HashMap<>();
    for (ParsedProductRow row : parsed) {
      String nameKey = productNameMatchKey(row.data());
      if (!nameKey.endsWith(":")) nameCounts.merge(nameKey, 1, Integer::sum);
    }
    int warnings = 0, blocking = 0, added = 0;
    for (ParsedProductRow row : parsed) {
      Map<String, Object> data = row.data();
      String materialName = text(data.get("materialName"));
      String nameKey = productNameMatchKey(data);
      boolean duplicateName = !nameKey.endsWith(":") && nameCounts.getOrDefault(nameKey, 0) > 1;
      String validation;
      String diffType;
      if (materialName.isBlank()) {
        validation = "BLOCKED"; diffType = "ADDED"; blocking++;
        issue(taskId, "BLOCKING", "MATERIAL_NAME_REQUIRED", row.sheet(), row.rowNo(), "materialName", null, "物料名称不能为空");
      } else if (bool(data.get("customerTypeInvalid"))) {
        validation = "BLOCKED"; diffType = "ADDED"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_CUSTOMER_TYPE_INVALID", row.sheet(), row.rowNo(), "customerType", null,
            "客户类型只允许“综合”“特渠”或空");
      } else if (bool(data.get("rebateStatusInvalid"))) {
        validation = "BLOCKED"; diffType = "ADDED"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_REBATE_INVALID", row.sheet(), row.rowNo(), "rebateStatus", null,
            "是否返利只允许“是”“否”或空");
      } else if (duplicateName) {
        validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_NAME_DUPLICATE", row.sheet(), row.rowNo(), "materialName", materialName,
            "同一客户类型、同一返利类型下商品名称重复，请编辑或删除重复行");
      } else if (optionalProductMissing(data)) {
        validation = "WARNING"; diffType = "ADDED"; warnings++; added++;
        issue(taskId, "WARNING", "PRODUCT_INCOMPLETE", row.sheet(), row.rowNo(), null, null,
            "商品信息不完整；仍会进入 H5，价格缺失时不可下单，其他缺失字段不展示");
      } else {
        validation = "VALID"; diffType = "ADDED"; added++;
      }
      insertStaging(taskId, row.sheet(), row.rowNo(), productKey(data), diffType, validation, data, null);
    }
    return new ParseSummary(parsed.size(), added, warnings, blocking);
  }

  private ParseSummary parseWhitelist(long taskId, Workbook workbook) {
    Map<String, List<String>> aliases = whitelistAliases();
    List<Sheet> nonEmptySheets = new ArrayList<>();
    for (int index = 0; index < workbook.getNumberOfSheets(); index++) {
      Sheet candidate = workbook.getSheetAt(index);
      if (hasData(candidate)) nonEmptySheets.add(candidate);
    }
    if (nonEmptySheets.isEmpty()) throw DomainException.unprocessable("WHITELIST_SHEET_EMPTY", "白名单 Excel 中没有找到非空 Sheet");
    if (nonEmptySheets.size() > 1) {
      throw DomainException.unprocessable("WHITELIST_SHEET_COUNT_INVALID", "白名单 Excel 只允许一个非空 Sheet，当前发现：" +
          nonEmptySheets.stream().map(Sheet::getSheetName).collect(Collectors.joining("、")));
    }
    Sheet sheet = nonEmptySheets.getFirst();
    int headerRow = findHeader(sheet, "经销商电话", 30);
    Map<String, Integer> indexes = aliasIndexes(sheet.getRow(headerRow), aliases);
    requireHeaders(sheet.getSheetName(), indexes, List.of("customerType", "regionName", "branchName", "dealerShortName", "dealerFullName", "contactName", "dealerPhone"));
    if (indexes.get("customerType") != 0) {
      throw DomainException.unprocessable("WHITELIST_CUSTOMER_TYPE_COLUMN_INVALID", sheet.getSheetName() + " 的“客户类型”必须是第一列");
    }
    List<ParsedSensitiveRow> parsed = new ArrayList<>();
    Map<String, Integer> phones = new HashMap<>();
    Map<String, Integer> names = new HashMap<>();
    boolean hasTypedRows = false;
    boolean hasUnspecifiedRows = false;
    int count = 0;
    for (int rowNo = headerRow + 1; rowNo <= Math.min(sheet.getLastRowNum(), headerRow + 20_000); rowNo++) {
      Row row = sheet.getRow(rowNo);
      if (blank(row)) continue;
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("sequence", intText(cell(row, indexes.get("sequence")), count + 1));
      String rawCustomerType = cell(row, indexes.get("customerType"));
      String customerType = whitelistCustomerType(rawCustomerType);
      boolean invalidCustomerType = !rawCustomerType.isBlank() && "ALL".equals(customerType);
      data.put("customerType", customerType);
      data.put("customerTypeInvalid", invalidCustomerType);
      if (rawCustomerType.isBlank()) hasUnspecifiedRows = true; else hasTypedRows = true;
      data.put("regionName", cell(row, indexes.get("regionName")));
      data.put("branchName", cell(row, indexes.get("branchName")));
      data.put("dealerShortName", cell(row, indexes.get("dealerShortName")));
      data.put("dealerFullName", cell(row, indexes.get("dealerFullName")));
      data.put("dealerCategory", cell(row, indexes.get("dealerCategory")));
      data.put("contactName", cell(row, indexes.get("contactName")));
      data.put("confirmerName", cell(row, indexes.get("confirmerName")));
      String phone = CryptoService.normalizePhone(cell(row, indexes.get("dealerPhone")));
      String confirmerPhone = CryptoService.normalizePhone(cell(row, indexes.get("confirmerPhone")));
      data.put("phoneMasked", phone.isBlank() ? "" : CryptoService.maskPhone(phone));
      data.put("confirmerPhoneMasked", confirmerPhone.isBlank() ? "" : CryptoService.maskPhone(confirmerPhone));
      Map<String, Object> sensitive = Map.of("dealerPhone", phone, "confirmerPhone", confirmerPhone);
      if (!phone.isBlank()) phones.merge(customerType + "|" + phone, 1, Integer::sum);
      String nameKey = normalize(text(data.get("dealerFullName")));
      String branchKey = normalize(text(data.get("branchName")));
      if (!nameKey.isBlank()) names.merge(customerType + "|" + nameKey + "|" + branchKey, 1, Integer::sum);
      parsed.add(new ParsedSensitiveRow(sheet.getSheetName(), rowNo + 1, data, sensitive));
      count++;
    }
    if (parsed.isEmpty()) throw DomainException.unprocessable("WHITELIST_EMPTY", "Excel 中没有找到白名单数据行");
    boolean mixedCustomerType = hasTypedRows && hasUnspecifiedRows;
    if (!mixedCustomerType && !hasTypedRows && parsed.stream().anyMatch(row -> !text(row.data().get("regionName")).isBlank())) {
      throw DomainException.unprocessable("WHITELIST_REGION_MODE_INVALID", "客户类型全部为空时，大区也必须全部为空");
    }
    int warnings = 0, blocking = 0;
    for (ParsedSensitiveRow row : parsed) {
      String phone = text(row.sensitive().get("dealerPhone"));
      String customerType = text(row.data().get("customerType"));
      boolean invalidCustomerType = bool(row.data().get("customerTypeInvalid"));
      boolean invalid = !phone.matches("1\\d{10}") || text(row.data().get("dealerFullName")).isBlank();
      boolean duplicatePhone = !phone.isBlank() && phones.getOrDefault(customerType + "|" + phone, 0) > 1;
      boolean duplicateName = names.getOrDefault(customerType + "|" + normalize(text(row.data().get("dealerFullName"))) + "|" + normalize(text(row.data().get("branchName"))), 0) > 1;
      boolean blocked = invalidCustomerType || mixedCustomerType || invalid || duplicatePhone || duplicateName;
      String validation = blocked ? "BLOCKED" : "VALID";
      String diffType = duplicateName ? "PENDING_CONFIRMATION" : "ADDED";
      insertStaging(taskId, row.sheet(), row.rowNo(), customerType + ":" + normalize(text(row.data().get("dealerFullName"))) + ":" + normalize(text(row.data().get("branchName"))),
          diffType, validation, row.data(), crypto.encrypt(writeJson(row.sensitive())));
      if (blocked) {
        blocking++;
        String code = mixedCustomerType ? "WHITELIST_CUSTOMER_TYPE_MIXED" : invalidCustomerType ? "WHITELIST_CUSTOMER_TYPE_INVALID"
            : duplicateName ? "DUPLICATE_DEALER_NAME" : duplicatePhone ? "DUPLICATE_PHONE" : "WHITELIST_ROW_INVALID";
        String message = mixedCustomerType ? "客户类型不能部分填写、部分为空；请保证整张表全部填写或全部留空"
            : invalidCustomerType ? "客户类型只允许“综合客户”“特渠专业客户”或空"
            : duplicateName ? "同一客户类型、同一分公司下经销商全称重复；请核实后编辑或删除重复行"
            : duplicatePhone ? "同一客户类型下手机号重复；不同客户类型可以使用相同手机号" : "经销商全称或手机号无效";
        issue(taskId, "BLOCKING", code, row.sheet(), row.rowNo(), mixedCustomerType || invalidCustomerType ? "customerType" : invalid ? "dealerPhone" : duplicateName ? "dealerFullName" : null,
            invalid || duplicatePhone ? text(row.data().get("phoneMasked")) : text(row.data().get("dealerFullName")), message);
      }
    }
    return new ParseSummary(count, count - blocking, warnings, blocking);
  }

  private ParseSummary parseAttendance(long taskId, Workbook workbook) {
    Map<String, List<String>> aliases = attendanceAliases();
    int count = 0, warnings = 0, blocking = 0;
    for (int sheetIndex = 0; sheetIndex < workbook.getNumberOfSheets(); sheetIndex++) {
      Sheet sheet = workbook.getSheetAt(sheetIndex);
      if (sheet.getPhysicalNumberOfRows() == 0) continue;
      int headerRow = findAnyHeader(sheet, aliases.get("contactPhone"), 30);
      if (headerRow < 0) continue;
      Map<String, Integer> indexes = aliasIndexes(sheet.getRow(headerRow), aliases);
      requireHeaders(sheet.getSheetName(), indexes, aliases.keySet().stream().toList());
      for (int rowNo = headerRow + 1; rowNo <= Math.min(sheet.getLastRowNum(), headerRow + 20_000); rowNo++) {
        Row row = sheet.getRow(rowNo);
        if (blank(row)) continue;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("branchName", cell(row, indexes.get("branchName")));
        data.put("participantName", cell(row, indexes.get("participantName")));
        data.put("gender", cell(row, indexes.get("gender")));
        data.put("participantType", cell(row, indexes.get("participantType")));
        data.put("dealerFullName", cell(row, indexes.get("dealerFullName")));
        String phone = CryptoService.normalizePhone(cell(row, indexes.get("contactPhone")));
        data.put("phoneMasked", phone.isBlank() ? "" : CryptoService.maskPhone(phone));
        boolean missingDealer = text(data.get("dealerFullName")).isBlank();
        boolean phoneInvalid = !phone.isBlank() && !phone.matches("1\\d{10}");
        String validation = missingDealer ? "BLOCKED" : phoneInvalid || phone.isBlank() ? "WARNING" : "VALID";
        insertStaging(taskId, sheet.getSheetName(), rowNo + 1, normalize(text(data.get("dealerFullName"))), validation,
            data, crypto.encrypt(writeJson(Map.of("contactPhone", phone))));
        if ("BLOCKED".equals(validation)) { blocking++; issue(taskId, "BLOCKING", "DEALER_NAME_REQUIRED", sheet.getSheetName(), rowNo + 1, "dealerFullName", null, "经销商名称不能为空"); }
        else if ("WARNING".equals(validation)) { warnings++; issue(taskId, "WARNING", "ATTENDANCE_PHONE_INVALID", sheet.getSheetName(), rowNo + 1, "contactPhone", data.get("phoneMasked").toString(), "电话为空或格式异常，记录可导入，并改用经销商全称或简称尝试关联白名单"); }
        count++;
      }
    }
    if (count == 0) throw DomainException.unprocessable("ATTENDANCE_EMPTY", "Excel 中没有找到现场参会名单数据");
    return new ParseSummary(count, count - blocking, warnings, blocking);
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
        """, taskId, sheet, rowNo, truncate(rowKey, 250), diffType, validation, writeJson(data), writeJson(data), sensitive);
  }

  private void issue(long taskId, String severity, String code, String sheet, int rowNo, String field,
                     String masked, String message) {
    jdbc.update("""
        INSERT INTO import_error(import_task_id, severity, error_code, sheet_name, source_row_number, field_name, raw_value_masked, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, taskId, severity, code, sheet, rowNo, field, masked, message);
  }

  private int findHeader(Sheet sheet, String marker, int maxRows) {
    int index = findAnyHeader(sheet, List.of(marker), maxRows);
    if (index < 0) throw DomainException.unprocessable("IMPORT_HEADER_NOT_FOUND", sheet.getSheetName() + " 未找到“" + marker + "”表头");
    return index;
  }

  private int findAnyHeader(Sheet sheet, List<String> markers, int maxRows) {
    for (int i = 0; i <= Math.min(sheet.getLastRowNum(), maxRows); i++) {
      Row row = sheet.getRow(i);
      if (row == null) continue;
      for (Cell cell : row) {
        String value = normalize(formatter.formatCellValue(cell));
        if (markers.stream().map(ImportWorkbookProcessor::normalize).anyMatch(value::contains)) return i;
      }
    }
    return -1;
  }

  private Map<String, Integer> indexes(Row header, List<String> names) {
    Map<String, Integer> result = new LinkedHashMap<>();
    for (String name : names) result.put(name, findColumn(header, List.of(name)));
    return result;
  }

  private Map<String, Integer> aliasIndexes(Row header, Map<String, List<String>> aliases) {
    Map<String, Integer> result = new LinkedHashMap<>();
    aliases.forEach((key, values) -> result.put(key, findColumn(header, values)));
    return result;
  }

  private int findColumn(Row header, List<String> aliases) {
    if (header == null) return -1;
    for (Cell cell : header) {
      String value = normalize(formatter.formatCellValue(cell));
      for (String alias : aliases) if (value.equals(normalize(alias)) || value.contains(normalize(alias))) return cell.getColumnIndex();
    }
    return -1;
  }

  private static void requireHeaders(String sheet, Map<String, Integer> indexes, List<String> required) {
    List<String> missing = required.stream().filter(name -> indexes.getOrDefault(name, -1) < 0).toList();
    if (!missing.isEmpty()) throw DomainException.unprocessable("IMPORT_COLUMNS_MISSING", sheet + " 缺少字段：" + String.join("、", missing));
  }

  private String cell(Row row, int index) {
    if (row == null || index < 0) return "";
    Cell cell = row.getCell(index, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
    return cell == null ? "" : formatter.formatCellValue(cell).replace('\u00a0', ' ').trim();
  }

  private boolean blank(Row row) {
    if (row == null) return true;
    for (Cell cell : row) if (!formatter.formatCellValue(cell).trim().isEmpty()) return false;
    return true;
  }

  private boolean hasData(Sheet sheet) {
    for (Row row : sheet) if (!blank(row)) return true;
    return false;
  }

  private static Map<String, List<String>> whitelistAliases() {
    Map<String, List<String>> map = new LinkedHashMap<>();
    map.put("sequence", List.of("序号")); map.put("customerType", List.of("客户类型", "客户类型（综合客户/特渠专业客户）")); map.put("regionName", List.of("大区"));
    map.put("branchName", List.of("分公司名称", "分公司")); map.put("dealerShortName", List.of("经销商名称（简）", "经销商简称"));
    map.put("dealerFullName", List.of("经销商名称（全）", "经销商全称")); map.put("dealerCategory", List.of("经销商类型", "综合经销商特渠专业经销商"));
    map.put("contactName", List.of("经销商姓名")); map.put("dealerPhone", List.of("经销商电话"));
    map.put("confirmerName", List.of("分公司确认人姓名")); map.put("confirmerPhone", List.of("分公司确认人电话"));
    return map;
  }

  static String whitelistCustomerType(String value) {
    String normalized = text(value).replaceAll("\\s+", "");
    if (normalized.isBlank()) return "ALL";
    if (normalized.contains("特渠")) return "SPECIAL";
    if (normalized.contains("综合")) return "GENERAL";
    return "ALL";
  }

  private static Map<String, List<String>> attendanceAliases() {
    Map<String, List<String>> map = new LinkedHashMap<>();
    map.put("branchName", List.of("分公司", "分公司名称", "所属分公司"));
    map.put("participantName", List.of("参会人姓名", "经销商姓名", "联系人姓名", "客户姓名", "姓名"));
    map.put("gender", List.of("性别")); map.put("contactPhone", List.of("参会人电话", "联系电话", "经销商电话", "手机号", "手机号码", "电话"));
    map.put("participantType", List.of("参会人员类型", "客户类型", "客户类别", "订货通道", "渠道类型"));
    map.put("dealerFullName", List.of("经销商名称", "经销商名称（全）", "经销商全称", "客户名称", "单位名称"));
    return map;
  }

  private static boolean optionalProductMissing(Map<String, Object> data) {
    return List.of("productLine", "specification", "casePack", "casePrice", "tonCaseFactor")
        .stream().anyMatch(key -> text(data.get(key)).isBlank());
  }

  private static String priceTierError(Map<String, Object> data) {
    String quantityText = text(data.get("priceTierMinQuantity"));
    String priceText = text(data.get("priceTierCasePrice"));
    String pricingMode = text(data.get("priceTierPricingMode"));
    if (quantityText.isBlank() && priceText.isBlank()) return null;
    if (quantityText.isBlank() || priceText.isBlank()) return "请同时填写阶梯起订箱数和阶梯箱价";
    if (!pricingMode.isBlank() && !Set.of("WHOLE_ORDER", "INCREMENTAL").contains(pricingMode)) return "阶梯计价模式不正确";
    try {
      BigDecimal quantity = new BigDecimal(quantityText);
      BigDecimal tierPrice = new BigDecimal(priceText);
      BigDecimal basePrice = new BigDecimal(text(data.get("casePrice")));
      if (quantity.stripTrailingZeros().scale() > 0 || quantity.compareTo(BigDecimal.valueOf(2)) < 0
          || quantity.compareTo(BigDecimal.valueOf(999_999)) > 0) {
        return "阶梯起订箱数必须为 2 至 999999 的整数";
      }
      if (tierPrice.signum() <= 0 || basePrice.signum() <= 0 || tierPrice.compareTo(basePrice) >= 0) {
        return "阶梯箱价必须大于 0 且低于基础箱价";
      }
      return null;
    } catch (NumberFormatException exception) {
      return "阶梯起订箱数和阶梯箱价格式不正确";
    }
  }

  private static String productKey(Map<String, Object> data) {
    return productNameMatchKey(data);
  }

  static String productCustomerType(String value) {
    return switch (text(value)) {
      case "综合" -> "GENERAL";
      case "特渠" -> "SPECIAL";
      case "" -> "ALL";
      default -> "ALL";
    };
  }

  static String productRebateStatus(String value) {
    return switch (text(value)) {
      case "是" -> "PARTICIPATING";
      case "否" -> "NOT_PARTICIPATING";
      case "" -> "ALL";
      default -> "ALL";
    };
  }

  static String productNameMatchKey(Map<String, Object> data) {
    return text(data.get("customerType")) + ":" + text(data.get("rebateStatus")) + ":" + normalize(text(data.get("materialName")));
  }

  private static String decimalText(String value) {
    try { return value == null || value.isBlank() ? "" : new BigDecimal(value.replace(",", "")).stripTrailingZeros().toPlainString(); }
    catch (Exception ignored) { return ""; }
  }

  private static String positiveDecimalText(String value) {
    String parsed = decimalText(value);
    try { return !parsed.isBlank() && new BigDecimal(parsed).signum() > 0 ? parsed : ""; }
    catch (Exception ignored) { return ""; }
  }

  private static BigDecimal decimal(Object value) {
    try { String text = text(value); return text.isBlank() ? null : new BigDecimal(text.replace(",", "")); }
    catch (Exception ignored) { return null; }
  }

  private static int intValue(Object value, int fallback) {
    try { return Integer.parseInt(text(value)); } catch (Exception ignored) { return fallback; }
  }
  private static int intText(String value, int fallback) { return intValue(value, fallback); }
  private static boolean bool(Object value) { return value instanceof Boolean b ? b : Boolean.parseBoolean(text(value)); }
  private static String nullableText(Object value) { String text = text(value); return text.isBlank() ? null : text; }
  private static String text(Object value) { return value == null ? "" : value.toString().trim(); }
  private static String normalize(String value) { return text(value).toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", ""); }
  private static String truncate(String value, int max) { String safe = Objects.requireNonNullElse(value, ""); return safe.length() <= max ? safe : safe.substring(0, max); }

  private String writeJson(Object value) {
    try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  record ParseSummary(int inputCount, int addedCount, int warnings, int blocking) {}
  private record ParsedProductRow(String sheet, int rowNo, Map<String, Object> data) {}
  private record ParsedSensitiveRow(String sheet, int rowNo, Map<String, Object> data, Map<String, Object> sensitive) {}
  private record ReviewRow(long id, String sheet, int rowNo, Map<String, Object> data,
                           Map<String, Object> sensitive, boolean deleted) {}
  private record MaterializeRow(long id, Map<String, Object> normalized, Map<String, Object> edited,
                                byte[] sensitiveBytes, byte[] editedSensitiveBytes) {
    Map<String, Object> effective() {
      Map<String, Object> result = new LinkedHashMap<>(normalized);
      if (edited != null) result.putAll(edited);
      return result;
    }

    Map<String, Object> sensitive(CryptoService crypto, ObjectMapper json) {
      byte[] bytes = editedSensitiveBytes != null ? editedSensitiveBytes : sensitiveBytes;
      if (bytes == null) return Map.of();
      try {
        return json.readValue(crypto.decrypt(bytes), new TypeReference<>() {});
      } catch (Exception exception) {
        throw new IllegalStateException(exception);
      }
    }
  }
}
