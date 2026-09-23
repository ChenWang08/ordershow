package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportWorkbookRules.*;
import com.fengyi.ordershow.imports.ImportWorkbookProcessor.ParseSummary;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;


/** Parses and validates without database writes; each call has its own formatter and buffer. */
final class ImportWorkbookReader {
  private final DataFormatter formatter = new DataFormatter(Locale.CHINA);
  private final List<ParsedWorkbook.Entry> entries = new ArrayList<>();
  private ImportWorkbookReader() {}
  static ParsedWorkbook read(long taskId, String type, byte[] bytes) {
    var reader = new ImportWorkbookReader();
    var summary = reader.parse(taskId, type, bytes);
    return new ParsedWorkbook(summary, List.copyOf(reader.entries));
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
    int branchColumn = findColumn(sheet.getRow(headerRow), List.of("分公司限制", "分公司定制品"));
    indexes.put("分公司定制品", branchColumn);
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

    Set<Integer> duplicateProductIndexes = duplicateProductRowIndexes(parsed.stream().map(ParsedProductRow::data).toList());
    int warnings = 0, blocking = 0, added = 0;
    for (int index = 0; index < parsed.size(); index++) {
      ParsedProductRow row = parsed.get(index);
      Map<String, Object> data = row.data();
      String materialName = text(data.get("materialName"));
      boolean duplicateIdentity = duplicateProductIndexes.contains(index);
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
      } else if (duplicateIdentity) {
        validation = "BLOCKED"; diffType = "PENDING_CONFIRMATION"; blocking++;
        issue(taskId, "BLOCKING", "PRODUCT_NAME_DUPLICATE", row.sheet(), row.rowNo(), "materialName", materialName,
            "同一客户类型、同一返利类型下商品名称与物料代码组合重复；任一物料代码为空时按名称判重，请编辑或删除重复行");
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
          diffType, validation, row.data(), row.sensitive());
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
            data, Map.of("contactPhone", phone));
        if ("BLOCKED".equals(validation)) { blocking++; issue(taskId, "BLOCKING", "DEALER_NAME_REQUIRED", sheet.getSheetName(), rowNo + 1, "dealerFullName", null, "经销商名称不能为空"); }
        else if ("WARNING".equals(validation)) { warnings++; issue(taskId, "WARNING", "ATTENDANCE_PHONE_INVALID", sheet.getSheetName(), rowNo + 1, "contactPhone", data.get("phoneMasked").toString(), "电话为空或格式异常，记录可导入，并改用经销商全称或简称尝试关联白名单"); }
        count++;
      }
    }
    if (count == 0) throw DomainException.unprocessable("ATTENDANCE_EMPTY", "Excel 中没有找到现场参会名单数据");
    return new ParseSummary(count, count - blocking, warnings, blocking);
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
        if (markers.stream().map(ImportWorkbookRules::normalize).anyMatch(value::contains)) return i;
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

  private static Map<String, List<String>> attendanceAliases() {
    Map<String, List<String>> map = new LinkedHashMap<>();
    map.put("branchName", List.of("分公司", "分公司名称", "所属分公司"));
    map.put("participantName", List.of("参会人姓名", "经销商姓名", "联系人姓名", "客户姓名", "姓名"));
    map.put("gender", List.of("性别")); map.put("contactPhone", List.of("参会人电话", "联系电话", "经销商电话", "手机号", "手机号码", "电话"));
    map.put("participantType", List.of("参会人员类型", "客户类型", "客户类别", "订货通道", "渠道类型"));
    map.put("dealerFullName", List.of("经销商名称", "经销商名称（全）", "经销商全称", "客户名称", "单位名称"));
    return map;
  }

  private void insertStaging(long taskId, String sheet, int rowNo, String rowKey, String validation,
      Map<String, Object> data, Map<String, Object> sensitive) {
    insertStaging(taskId, sheet, rowNo, rowKey, "ADDED", validation, data, sensitive);
  }
  private void insertStaging(long taskId, String sheet, int rowNo, String rowKey, String diffType, String validation,
      Map<String, Object> data, Map<String, Object> sensitive) {
    entries.add(new ParsedWorkbook.Staging(taskId, sheet, rowNo, rowKey, diffType, validation, new LinkedHashMap<>(data), sensitive));
  }
  private void issue(long taskId, String severity, String code, String sheet, int rowNo, String field, String masked, String message) {
    entries.add(new ParsedWorkbook.Issue(taskId, severity, code, sheet, rowNo, field, masked, message));
  }
  private record ParsedProductRow(String sheet, int rowNo, Map<String, Object> data) {}
  private record ParsedSensitiveRow(String sheet, int rowNo, Map<String, Object> data, Map<String, Object> sensitive) {}
}
