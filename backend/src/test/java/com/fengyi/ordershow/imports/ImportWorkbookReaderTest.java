package com.fengyi.ordershow.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ImportWorkbookReaderTest {
  private static final String[] HEADERS = {"客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明"};

  @Test
  void readsAProductWithoutDatabaseOrCryptoDependencies() throws Exception {
    var parsed = ImportWorkbookReader.read(7, "PRODUCT", product("测试商品"));
    assertThat(parsed.summary().inputCount()).isEqualTo(1);
    assertThat(parsed.summary().blocking()).isZero();
    assertThat(parsed.entries()).hasSize(1);
    var row = (ParsedWorkbook.Staging) parsed.entries().getFirst();
    assertThat(row.taskId()).isEqualTo(7);
    assertThat(row.sheet()).isEqualTo("商品目录");
    assertThat(row.rowNo()).isEqualTo(2);
    assertThat(row.data()).containsEntry("materialName", "测试商品").containsEntry("casePrice", "100");
  }

  @Test
  void acceptsNewBranchHeaderAndPreservesExcelScope() throws Exception {
    String[] headers=HEADERS.clone(); headers[14]="分公司限制";
    var parsed=ImportWorkbookReader.read(7,"PRODUCT",workbook("商品目录",headers,
      new String[]{"综合","是","调味品","酱油","P001","商品","品牌","原味","500ml","12瓶","8","100","10","否","上海分、安徽分","说明"}));
    assertThat(((ParsedWorkbook.Staging) parsed.entries().getFirst()).data()).containsEntry("branchScope","上海分、安徽分");
  }

  @Test
  void preservesIssueAndStagingOrderForBlockedRows() throws Exception {
    var parsed = ImportWorkbookReader.read(7, "PRODUCT", product(""));
    assertThat(parsed.summary().blocking()).isEqualTo(1);
    assertThat(parsed.entries().get(0)).isInstanceOf(ParsedWorkbook.Issue.class);
    assertThat(((ParsedWorkbook.Issue) parsed.entries().get(0)).code()).isEqualTo("MATERIAL_NAME_REQUIRED");
    assertThat(((ParsedWorkbook.Staging) parsed.entries().get(1)).validation()).isEqualTo("BLOCKED");
  }

  @Test
  void repeatedReadsDoNotReuseAnotherTasksRows() throws Exception {
    var first = ImportWorkbookReader.read(7, "PRODUCT", product("第一批"));
    var second = ImportWorkbookReader.read(8, "PRODUCT", product("第二批"));
    assertThat(first.entries()).hasSize(1);
    assertThat(second.entries()).hasSize(1);
    assertThat(((ParsedWorkbook.Staging) first.entries().getFirst()).data()).containsEntry("materialName", "第一批");
    assertThat(((ParsedWorkbook.Staging) second.entries().getFirst()).taskId()).isEqualTo(8);
  }

  @Test
  void rejectsUnreadableWorkbooks() {
    assertThatThrownBy(() -> ImportWorkbookReader.read(7, "PRODUCT", new byte[]{1, 2, 3}))
        .isInstanceOf(DomainException.class).satisfies(error -> assertThat(((DomainException) error).code()).isEqualTo("IMPORT_PARSE_FAILED"));
  }

  @Test
  void encryptsSensitiveValuesOnlyWhenPersistingTheParseResult() throws Exception {
    byte[] bytes = workbook("白名单", new String[]{"客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话"},
        new String[]{"", "", "甲分", "测试", "测试经销商", "测试人", "13800000001"});
    var parsed = ImportWorkbookReader.read(7, "WHITELIST", bytes);
    var row = (ParsedWorkbook.Staging) parsed.entries().getFirst();
    assertThat(row.sensitive()).containsEntry("dealerPhone", "13800000001");
    assertThat(row.data()).containsEntry("phoneMasked", "138****0001");
    var jdbc = mock(JdbcTemplate.class);
    var crypto = mock(CryptoService.class);
    byte[] encrypted = {9, 8, 7};
    when(crypto.encrypt(anyString())).thenReturn(encrypted);
    List<Object[]> writes = new ArrayList<>();
    doAnswer(invocation -> { writes.add((Object[]) invocation.getRawArguments()[1]); return 1; })
        .when(jdbc).update(anyString(), any(Object[].class));
    new ImportStagingWriter(jdbc, crypto, new ObjectMapper()).persist(parsed);
    assertThat(writes).hasSize(1);
    assertThat(writes.getFirst()[6].toString()).doesNotContain("13800000001");
    assertThat(writes.getFirst()[8]).isEqualTo(encrypted);
  }

  private byte[] product(String name) throws Exception {
    return workbook("商品目录", HEADERS, new String[]{"综合", "是", "调味品", "酱油", "P001", name, "品牌", "原味", "500ml", "12瓶", "8", "100", "10", "否", "", "说明"});
  }

  private byte[] workbook(String name, String[] headers, String[] values) throws Exception {
    try (var workbook = new XSSFWorkbook(); var output = new ByteArrayOutputStream()) {
      var sheet = workbook.createSheet(name);
      var header = sheet.createRow(0);
      var row = sheet.createRow(1);
      for (int index = 0; index < headers.length; index++) header.createCell(index).setCellValue(headers[index]);
      for (int index = 0; index < values.length; index++) row.createCell(index).setCellValue(values[index]);
      workbook.write(output);
      return output.toByteArray();
    }
  }
}
