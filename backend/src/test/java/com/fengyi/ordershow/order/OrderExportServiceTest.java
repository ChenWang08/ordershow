package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

class OrderExportServiceTest {
  private final OrderQueryService queries = mock(OrderQueryService.class);
  private final OrderExportService exporter = new OrderExportService(queries);

  @Test
  void exportsFourSheetsWithFullAdminPhoneAmountsAndBlankUnknownTons() throws Exception {
    Instant time = Instant.parse("2026-09-01T10:00:00Z");
    var order = new OrderService.OrderSummary(1, "ZY-1", "SUBMITTED", "ADMIN", "ADMIN", "GENERAL", "EAST",
        "测试分公司", "测试客户", "13800000000", "138****0000", 2, 3, 1500L, null,
        new BigDecimal("203998.00"), time, time, time);
    Map<String, Object> detail = Map.of("order_no", "ZY-1", "phone", "13800000000", "created_source", "ADMIN",
        "pricing_mode", "INCREMENTAL", "base_price_quantity", 1499, "tier_price_quantity", 1,
        "applied_tier_min_quantity", 1500, "line_amount", new BigDecimal("203998.00"));
    when(queries.exportData(7, null, "GENERAL", "客户")).thenReturn(new OrderQueryService.ExportData(
        List.of(order), List.of(detail), List.of(Map.of("material_name", "测试商品")), List.of(Map.of("branch_name_snapshot", "测试分公司"))));

    try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(exporter.export(7, null, "GENERAL", "客户")))) {
      assertThat(workbook.getNumberOfSheets()).isEqualTo(4);
      assertThat(workbook.getSheetName(0)).isEqualTo("订单汇总");
      assertThat(workbook.getSheetName(1)).isEqualTo("订单商品明细");
      assertThat(workbook.getSheetName(2)).isEqualTo("有效商品汇总");
      assertThat(workbook.getSheetName(3)).isEqualTo("有效分公司汇总");
      var summary = workbook.getSheetAt(0).getRow(1);
      assertThat(summary.getCell(2).getStringCellValue()).isEqualTo("管理员");
      assertThat(summary.getCell(7).getStringCellValue()).isEqualTo("13800000000");
      assertThat(summary.getCell(10).getStringCellValue()).isEmpty();
      assertThat(summary.getCell(11).getStringCellValue()).isEqualTo("203998.00");
      var item = workbook.getSheetAt(1).getRow(1);
      assertThat(workbook.getSheetAt(1).getRow(0).getCell(12).getStringCellValue()).isEqualTo("项目组");
      assertThat(item.getCell(16).getStringCellValue()).isEqualTo("INCREMENTAL");
      assertThat(item.getCell(18).getStringCellValue()).isEqualTo("1499");
      assertThat(item.getCell(20).getStringCellValue()).isEqualTo("1");
      assertThat(item.getCell(22).getStringCellValue()).isEqualTo("是");
      assertThat(workbook.getSheetAt(1).getPaneInformation().isFreezePane()).isTrue();
      assertThat(workbook.getSheetAt(2).getRow(0).getCell(2).getStringCellValue()).isEqualTo("项目组");
    }
  }

  @Test
  void emptyExportsKeepAllSheetHeaders() throws Exception {
    when(queries.exportData(7, null, null, null)).thenReturn(new OrderQueryService.ExportData(List.of(), List.of(), List.of(), List.of()));
    try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(exporter.export(7, null, null, null)))) {
      assertThat(workbook.getNumberOfSheets()).isEqualTo(4);
      for (var sheet : workbook) assertThat(sheet.getPhysicalNumberOfRows()).isEqualTo(1);
    }
  }
}
