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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
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
  private static final List<SheetConfig> PRODUCT_SHEETS = List.of(
      new SheetConfig("综合参与返利", "GENERAL", "PARTICIPATING"),
      new SheetConfig("综合不参与返利", "GENERAL", "NOT_PARTICIPATING"),
      new SheetConfig("特渠参与返利", "SPECIAL", "PARTICIPATING"),
      new SheetConfig("特渠不参与返利", "SPECIAL", "NOT_PARTICIPATING"));
  private static final List<SheetConfig> WHITELIST_SHEETS = List.of(
      new SheetConfig("综合客户白名单", "GENERAL", null),
      new SheetConfig("特渠客户白名单", "SPECIAL", null));

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
    if ("WHITELIST".equals(importType)) {
      for (ReviewRow row : rows) {
        if (row.deleted()) continue;
        String phone = text(row.sensitive().get("dealerPhone"));
        if (!phone.isBlank()) whitelistPhones.merge(text(row.data().get("customerType")) + "|" + phone, 1, Integer::sum);
        String name = normalize(text(row.data().get("dealerFullName")));
        if (!name.isBlank()) whitelistNames.merge(text(row.data().get("customerType")) + "|" + name, 1, Integer::sum);
      }
    }
    Map<String, Integer> productCodes = new HashMap<>();
    Map<String, Set<String>> productNameCodes = new HashMap<>();
    if ("PRODUCT".equals(importType)) {
      for (ReviewRow row : rows) {
        if (row.deleted()) continue;
        productCodes.merge(productMatchKey(row.data()), 1, Integer::sum);
        productNameCodes.computeIfAbsent(productNameMatchKey(row.data()), ignored -> new HashSet<>())
            .add(normalize(text(row.data().get("materialCode"))));
      }
    }
    Map<String, String> primaryProductNameCode = new HashMap<>();

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
          String code = normalize(text(row.data().get("materialCode")));
          String nameKey = productNameMatchKey(row.data());
          String primaryCode = primaryProductNameCode.computeIfAbsent(nameKey, ignored -> code);
          boolean repeatedCode = productCodes.getOrDefault(productMatchKey(row.data()), 0) > 1;
          boolean possibleDuplicate = !repeatedCode && productNameCodes.getOrDefault(nameKey, Set.of()).size() > 1
              && !Objects.equals(primaryCode, code) && !bool(row.data().get("duplicateConfirmed"));
          if (text(row.data().get("materialName")).isBlank()) {
            validation = "BLOCKED"; blocking++;
            issue(taskId, "BLOCKING", "MATERIAL_NAME_REQUIRED", row.sheet(), row.rowNo(), "materialName", null, "物料名称不能为空");
          } else if (repeatedCode) {
            validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_CODE_MULTIPLE_MATCH", row.sheet(), row.rowNo(), "materialCode", code,
                "同一客户通道和返利类型下物料代码重复，且商品信息存在冲突；请编辑或删除重复行");
          } else if (possibleDuplicate) {
            validation = "BLOCKED"; diffType = "POSSIBLE_DUPLICATE"; blocking++;
            issue(taskId, "BLOCKING", "PRODUCT_NAME_POSSIBLE_DUPLICATE", row.sheet(), row.rowNo(), "materialName",
                text(row.data().get("materialName")), "商品名称相同但物料代码不同；请确认后保留或删除");
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
          boolean invalid = !phone.matches("1\\d{10}") || text(row.data().get("dealerFullName")).isBlank();
          boolean duplicatePhone = !phone.isBlank() && whitelistPhones.getOrDefault(text(row.data().get("customerType")) + "|" + phone, 0) > 1;
          boolean duplicateName = whitelistNames.getOrDefault(text(row.data().get("customerType")) + "|" + normalize(text(row.data().get("dealerFullName"))), 0) > 1;
          if (invalid || duplicatePhone || duplicateName) {
            validation = "BLOCKED"; blocking++;
            if (duplicateName) diffType = "PENDING_CONFIRMATION";
            String code = duplicateName ? "DUPLICATE_DEALER_NAME" : duplicatePhone ? "DUPLICATE_PHONE" : "WHITELIST_ROW_INVALID";
            String message = duplicateName ? "同一客户类型下经销商全称重复；请核实后编辑或删除重复行"
                : duplicatePhone ? "同一客户通道内手机号重复" : "经销商全称或手机号无效";
            issue(taskId, "BLOCKING", code, row.sheet(), row.rowNo(), invalid ? "dealerPhone" : duplicateName ? "dealerFullName" : null,
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
    List<String> headers = List.of("产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品");
    List<ParsedProductRow> parsed = new ArrayList<>();
    for (SheetConfig config : PRODUCT_SHEETS) {
      Sheet sheet = workbook.getSheet(config.name());
      if (sheet == null) throw DomainException.unprocessable("PRODUCT_SHEET_MISSING", "缺少必要 Sheet：" + config.name());
      int headerRow = findHeader(sheet, "物料名称", 20);
      Map<String, Integer> indexes = indexes(sheet.getRow(headerRow), headers);
      requireHeaders(config.name(), indexes, headers);
      for (int rowNo = headerRow + 1; rowNo <= sheet.getLastRowNum(); rowNo++) {
        Row row = sheet.getRow(rowNo);
        if (blank(row)) continue;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("customerType", config.customerType());
        data.put("rebateStatus", config.rebateStatus());
        data.put("categoryName", cell(row, indexes.get("产品大类")));
        data.put("productLine", cell(row, indexes.get("产品线")));
        data.put("materialCode", cell(row, indexes.get("物料代码")));
        data.put("materialName", cell(row, indexes.get("物料名称")));
        data.put("brandName", cell(row, indexes.get("品牌")));
        data.put("varietyName", cell(row, indexes.get("品种")));
        data.put("specification", cell(row, indexes.get("规格")));
        data.put("casePack", cell(row, indexes.get("箱规")));
        data.put("bottlePrice", decimalText(cell(row, indexes.get("元/瓶"))));
        data.put("casePrice", decimalText(cell(row, indexes.get("元/箱"))));
        data.put("tonCaseFactor", positiveDecimalText(cell(row, indexes.get("吨箱转换系数"))));
        data.put("giftBox", "是".equals(cell(row, indexes.get("是否为标品礼盒"))));
        data.put("branchScope", cell(row, indexes.get("分公司定制品")));
        parsed.add(new ParsedProductRow(config.name(), rowNo + 1, data));
      }
    }

    Map<String, Integer> codeCounts = new HashMap<>();
    Map<String, Set<String>> nameCodes = new HashMap<>();
    for (ParsedProductRow row : parsed) {
      String codeKey = productMatchKey(row.data());
      codeCounts.merge(codeKey, 1, Integer::sum);
      nameCodes.computeIfAbsent(productNameMatchKey(row.data()), ignored -> new HashSet<>())
          .add(normalize(text(row.data().get("materialCode"))));
    }
    Map<String, String> primaryNameCode = new HashMap<>();
    int warnings = 0, blocking = 0, added = 0;
    for (ParsedProductRow row : parsed) {
      Map<String, Object> data = row.data();
      String materialName = text(data.get("materialName"));
      String codeKey = productMatchKey(data);
      String nameKey = productNameMatchKey(data);
      String code = normalize(text(data.get("materialCode")));
      String primaryCode = primaryNameCode.computeIfAbsent(nameKey, ignored -> code);
      boolean repeatedCode = codeCounts.getOrDefault(codeKey, 0) > 1;
      boolean possibleDuplicate = !repeatedCode && nameCodes.getOrDefault(nameKey, Set.of()).size() > 1 && !Objects.equals(primaryCode, code);
      String validation;
      String diffType;
      if (materialName.isBlank()) {
        validation = "BLOCKED"; diffType = "ADDED"; blocking++;
        issue(taskId, "BLOCKING", "MATERIAL_NAME_REQUIRED", row.sheet(), row.rowNo(), "materialName", null, "物料名称不能为空");
      } else if (repeatedCode) {
        validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_CODE_MULTIPLE_MATCH", row.sheet(), row.rowNo(), "materialCode", code,
            "同一客户通道和返利类型下物料代码重复，且商品信息存在冲突；请编辑或删除重复行");
      } else if (possibleDuplicate) {
        validation = "BLOCKED"; diffType = "POSSIBLE_DUPLICATE"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_NAME_POSSIBLE_DUPLICATE", row.sheet(), row.rowNo(), "materialName", materialName,
            "商品名称相同但物料代码不同；请确认后保留或删除");
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
    int count = 0, warnings = 0, blocking = 0;
    for (SheetConfig config : WHITELIST_SHEETS) {
      Sheet sheet = workbook.getSheet(config.name());
      if (sheet == null) throw DomainException.unprocessable("WHITELIST_SHEET_MISSING", "缺少必要 Sheet：" + config.name());
      int headerRow = findHeader(sheet, "经销商电话", 30);
      Map<String, Integer> indexes = aliasIndexes(sheet.getRow(headerRow), aliases);
      requireHeaders(config.name(), indexes, aliases.keySet().stream().toList());
      List<ParsedSensitiveRow> parsed = new ArrayList<>();
      Map<String, Integer> phones = new HashMap<>();
      Map<String, Integer> names = new HashMap<>();
      for (int rowNo = headerRow + 1; rowNo <= Math.min(sheet.getLastRowNum(), headerRow + 20_000); rowNo++) {
        Row row = sheet.getRow(rowNo);
        if (blank(row)) continue;
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sequence", intText(cell(row, indexes.get("sequence")), count + 1));
        data.put("customerType", config.customerType());
        data.put("regionName", cell(row, indexes.get("regionName")));
        data.put("branchName", cell(row, indexes.get("branchName")));
        data.put("dealerShortName", cell(row, indexes.get("dealerShortName")));
        data.put("dealerFullName", cell(row, indexes.get("dealerFullName")));
        data.put("dealerCategory", cell(row, indexes.get("dealerCategory")));
        data.put("contactName", cell(row, indexes.get("contactName")));
        data.put("confirmerName", cell(row, indexes.get("confirmerName")));
        String phone = CryptoService.normalizePhone(cell(row, indexes.get("dealerPhone")));
        String confirmerPhone = CryptoService.normalizePhone(cell(row, indexes.get("confirmerPhone")));
        data.put("phoneMasked", CryptoService.maskPhone(phone));
        data.put("confirmerPhoneMasked", confirmerPhone.isBlank() ? "" : CryptoService.maskPhone(confirmerPhone));
        Map<String, Object> sensitive = Map.of("dealerPhone", phone, "confirmerPhone", confirmerPhone);
        phones.merge(phone, 1, Integer::sum);
        String nameKey = normalize(text(data.get("dealerFullName")));
        if (!nameKey.isBlank()) names.merge(nameKey, 1, Integer::sum);
        parsed.add(new ParsedSensitiveRow(config.name(), rowNo + 1, data, sensitive));
      }
      for (ParsedSensitiveRow row : parsed) {
        String phone = text(row.sensitive().get("dealerPhone"));
        boolean invalid = !phone.matches("1\\d{10}") || text(row.data().get("dealerFullName")).isBlank();
        boolean duplicatePhone = !phone.isBlank() && phones.getOrDefault(phone, 0) > 1;
        boolean duplicateName = names.getOrDefault(normalize(text(row.data().get("dealerFullName"))), 0) > 1;
        String validation = invalid || duplicatePhone || duplicateName ? "BLOCKED" : "VALID";
        String diffType = duplicateName ? "PENDING_CONFIRMATION" : "ADDED";
        insertStaging(taskId, row.sheet(), row.rowNo(), config.customerType() + ":" + normalize(text(row.data().get("dealerFullName"))),
            diffType, validation, row.data(), crypto.encrypt(writeJson(row.sensitive())));
        if (!"VALID".equals(validation)) {
          blocking++;
          String code = duplicateName ? "DUPLICATE_DEALER_NAME" : duplicatePhone ? "DUPLICATE_PHONE" : "WHITELIST_ROW_INVALID";
          String message = duplicateName ? "同一客户类型下经销商全称重复；请核实后编辑或删除重复行"
              : duplicatePhone ? "同一客户通道内手机号重复" : "经销商全称或手机号无效";
          issue(taskId, "BLOCKING", code, row.sheet(), row.rowNo(), invalid ? "dealerPhone" : duplicateName ? "dealerFullName" : null,
              invalid || duplicatePhone ? row.data().get("phoneMasked").toString() : text(row.data().get("dealerFullName")), message);
        }
        count++;
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

  private static Map<String, List<String>> whitelistAliases() {
    Map<String, List<String>> map = new LinkedHashMap<>();
    map.put("sequence", List.of("序号")); map.put("regionName", List.of("大区"));
    map.put("branchName", List.of("分公司名称", "分公司")); map.put("dealerShortName", List.of("经销商名称（简）", "经销商简称"));
    map.put("dealerFullName", List.of("经销商名称（全）", "经销商全称")); map.put("dealerCategory", List.of("经销商类型", "综合经销商特渠专业经销商"));
    map.put("contactName", List.of("经销商姓名")); map.put("dealerPhone", List.of("经销商电话"));
    map.put("confirmerName", List.of("分公司确认人姓名")); map.put("confirmerPhone", List.of("分公司确认人电话"));
    return map;
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
    return List.of("materialCode", "productLine", "specification", "casePack", "casePrice", "tonCaseFactor")
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
    String prefix = text(data.get("customerType")) + ":" + text(data.get("rebateStatus")) + ":";
    String code = normalize(text(data.get("materialCode")));
    return prefix + (!code.isBlank() ? code : normalize(text(data.get("materialName"))));
  }

  private static String productMatchKey(Map<String, Object> data) {
    String code = normalize(text(data.get("materialCode")));
    String identity = !code.isBlank() ? "code:" + code : "name:" + normalize(text(data.get("materialName")));
    return text(data.get("customerType")) + ":" + text(data.get("rebateStatus")) + ":" + identity;
  }

  private static String productNameMatchKey(Map<String, Object> data) {
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
  private static String normalize(String value) { return text(value).toLowerCase(Locale.CHINA).replaceAll("[\\s　_-]+", ""); }
  private static String truncate(String value, int max) { String safe = Objects.requireNonNullElse(value, ""); return safe.length() <= max ? safe : safe.substring(0, max); }

  private String writeJson(Object value) {
    try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }
  private Map<String, Object> readMap(String value) {
    if (value == null || value.isBlank()) return new LinkedHashMap<>();
    try { return json.readValue(value, new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
  }

  record ParseSummary(int inputCount, int addedCount, int warnings, int blocking) {}
  private record SheetConfig(String name, String customerType, String rebateStatus) {}
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
