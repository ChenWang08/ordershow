package com.fengyi.ordershow.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.jdbc.core.JdbcTemplate;

class ImportWorkbookProcessorRulesTest {
  private static final List<String> HEADERS = List.of(
      "客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规",
      "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明");

  @Test
  void usesTypeRebateNameAndMaterialCodeRulesForProductDuplicates() throws Exception {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    List<Object[]> stagingRows = captureStagingRows(jdbc);
    ImportWorkbookProcessor processor = new ImportWorkbookProcessor(jdbc, mock(CryptoService.class), new ObjectMapper());

    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      var sheet = workbook.createSheet("统一商品表");
      writeRow(sheet.createRow(0), HEADERS.toArray(String[]::new));
      writeRow(sheet.createRow(1), "综合", "是", "调味品", "酱油", "P001", "同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明A");
      writeRow(sheet.createRow(2), "综合", "是", "调味品", "酱油", "P002", "同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明B");
      writeRow(sheet.createRow(3), "综合", "是", "调味品", "酱油", "p-002", "同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明C");
      writeRow(sheet.createRow(4), "综合", "是", "调味品", "酱油", "", "空码同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明D");
      writeRow(sheet.createRow(5), "综合", "是", "调味品", "酱油", "Q001", "空码同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明E");
      writeRow(sheet.createRow(6), "综合", "是", "调味品", "酱油", "", "双空码商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明F");
      writeRow(sheet.createRow(7), "综合", "是", "调味品", "酱油", "", "双空码商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明G");
      writeRow(sheet.createRow(8), "特渠", "是", "调味品", "酱油", "P001", "同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明H");
      writeRow(sheet.createRow(9), "综合", "否", "调味品", "酱油", "P001", "同名商品", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明I");
      writeRow(sheet.createRow(10), "", "", "调味品", "酱油", "", "空类型空返利混码", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明J");
      writeRow(sheet.createRow(11), "", "", "调味品", "酱油", "G001", "空类型空返利混码", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明K");
      writeRow(sheet.createRow(12), "", "", "调味品", "酱油", "G002", "空类型空返利不同码", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明L");
      writeRow(sheet.createRow(13), "", "", "调味品", "酱油", "G003", "空类型空返利不同码", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明M");
      workbook.write(output);

      var summary = processor.parse(1, "PRODUCT", output.toByteArray());
      assertThat(summary.inputCount()).isEqualTo(13);
      assertThat(summary.addedCount()).isEqualTo(5);
      assertThat(summary.warnings()).isZero();
      assertThat(summary.blocking()).isEqualTo(8);
    }

    assertThat(stagingRows).hasSize(13);
    assertThat(stagingRows.get(0)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(1)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(2)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(0)[3]).isNotEqualTo(stagingRows.get(1)[3]);
    assertThat(stagingRows.get(3)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(4)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(5)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(6)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(7)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(8)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(9)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(10)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(11)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(12)[5]).isEqualTo("VALID");
    JsonNode genericData = new ObjectMapper().readTree((String) stagingRows.get(9)[6]);
    assertThat(genericData.path("materialCode").asText()).isEmpty();
    assertThat(genericData.path("customerType").asText()).isEqualTo("ALL");
    assertThat(genericData.path("rebateStatus").asText()).isEqualTo("ALL");
  }

  @Test
  void rejectsMoreThanOneNonEmptyProductSheet() throws Exception {
    ImportWorkbookProcessor processor = new ImportWorkbookProcessor(mock(JdbcTemplate.class), mock(CryptoService.class), new ObjectMapper());
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      var first = workbook.createSheet("商品一");
      writeRow(first.createRow(0), HEADERS.toArray(String[]::new));
      writeRow(first.createRow(1), "综合", "是", "调味品", "酱油", "P001", "商品一", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "");
      var second = workbook.createSheet("商品二");
      writeRow(second.createRow(0), HEADERS.toArray(String[]::new));
      writeRow(second.createRow(1), "综合", "是", "调味品", "酱油", "P002", "商品二", "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "");
      workbook.write(output);

      assertThatThrownBy(() -> processor.parse(1, "PRODUCT", output.toByteArray()))
          .isInstanceOf(DomainException.class)
          .hasMessageContaining("只允许一个非空 Sheet");
    }
  }

  @Test
  void mapsBlankAndAllowedProductTypeValuesToGenericSentinels() {
    assertThat(ImportWorkbookRules.productCustomerType("综合")).isEqualTo("GENERAL");
    assertThat(ImportWorkbookRules.productCustomerType("特渠")).isEqualTo("SPECIAL");
    assertThat(ImportWorkbookRules.productCustomerType(" ")).isEqualTo("ALL");
    assertThat(ImportWorkbookRules.productRebateStatus("是")).isEqualTo("PARTICIPATING");
    assertThat(ImportWorkbookRules.productRebateStatus("否")).isEqualTo("NOT_PARTICIPATING");
    assertThat(ImportWorkbookRules.productRebateStatus(" ")).isEqualTo("ALL");
  }

  @Test
  void usesOneWhitelistSheetAndTypeBranchIdentity() throws Exception {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    List<Object[]> stagingRows = captureStagingRows(jdbc);
    ImportWorkbookProcessor processor = new ImportWorkbookProcessor(jdbc, mock(CryptoService.class), new ObjectMapper());
    List<String> headers = List.of("客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话");

    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      var sheet = workbook.createSheet("名称随意");
      writeRow(sheet.createRow(0), headers.toArray(String[]::new));
      writeRow(sheet.createRow(1), "", "", "甲分", "同名", "同一经销商", "甲", "13800000001", "", "");
      writeRow(sheet.createRow(2), "", "", "乙分", "同名", "同一经销商", "乙", "13800000002", "", "");
      writeRow(sheet.createRow(3), "", "", "甲分", "同名", "同一经销商", "丙", "13800000003", "", "");
      writeRow(sheet.createRow(4), "", "", "丙分", "另一个", "另一个经销商", "丁", "13800000004", "", "");
      writeRow(sheet.createRow(5), "", "", "丁分", "再一个", "再一个经销商", "戊", "13800000001", "", "");
      workbook.write(output);

      var summary = processor.parse(1, "WHITELIST", output.toByteArray());
      assertThat(summary.inputCount()).isEqualTo(5);
      assertThat(summary.addedCount()).isEqualTo(2);
      assertThat(summary.blocking()).isEqualTo(3);
    }

    assertThat(stagingRows).hasSize(5);
    assertThat(stagingRows.get(0)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(1)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(2)[5]).isEqualTo("BLOCKED");
    assertThat(stagingRows.get(3)[5]).isEqualTo("VALID");
    assertThat(stagingRows.get(4)[5]).isEqualTo("BLOCKED");
    JsonNode data = new ObjectMapper().readTree((String) stagingRows.get(0)[6]);
    assertThat(data.path("customerType").asText()).isEqualTo("ALL");
    assertThat(data.path("dealerCategory").asText()).isEmpty();
  }

  @Test
  void rejectsMixedBlankAndTypedWhitelistRows() throws Exception {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    List<Object[]> stagingRows = captureStagingRows(jdbc);
    ImportWorkbookProcessor processor = new ImportWorkbookProcessor(jdbc, mock(CryptoService.class), new ObjectMapper());
    List<String> headers = List.of("客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话");

    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      var sheet = workbook.createSheet("白名单");
      writeRow(sheet.createRow(0), headers.toArray(String[]::new));
      writeRow(sheet.createRow(1), "综合客户", "东区", "甲分", "甲", "综合经销商", "甲", "13800000001", "", "");
      writeRow(sheet.createRow(2), "", "", "乙分", "乙", "无类型经销商", "乙", "13800000002", "", "");
      workbook.write(output);

      var summary = processor.parse(1, "WHITELIST", output.toByteArray());
      assertThat(summary.inputCount()).isEqualTo(2);
      assertThat(summary.addedCount()).isZero();
      assertThat(summary.blocking()).isEqualTo(2);
    }
    assertThat(stagingRows).hasSize(2);
    assertThat(stagingRows).allSatisfy(row -> assertThat(row[5]).isEqualTo("BLOCKED"));
  }

  private static List<Object[]> captureStagingRows(JdbcTemplate jdbc) {
    List<Object[]> rows = new ArrayList<>();
    doAnswer((InvocationOnMock invocation) -> {
      String sql = invocation.getArgument(0, String.class);
      if (sql.contains("INSERT INTO import_staging_row")) {
        Object[] arguments = invocation.getArguments();
        if (arguments.length == 2 && arguments[1] instanceof Object[] values) rows.add(values);
        else rows.add(java.util.Arrays.copyOfRange(arguments, 1, arguments.length));
      }
      return 1;
    }).when(jdbc).update(anyString(), any(Object[].class));
    return rows;
  }

  private static void writeRow(org.apache.poi.ss.usermodel.Row row, String... values) {
    for (int index = 0; index < values.length; index++) row.createCell(index).setCellValue(values[index]);
  }
}
