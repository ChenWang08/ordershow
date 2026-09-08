package com.fengyi.ordershow.order;

import com.fengyi.ordershow.order.OrderService.OrderSummary;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

@Service
public class OrderExportService {
  private final OrderQueryService queries;

  public OrderExportService(OrderQueryService queries) {
    this.queries = queries;
  }

  public byte[] export(long activityId, String status, String customerType, String keyword) {
    var data = queries.exportData(activityId, status, customerType, keyword);
    var orders = data.orders();
    var details = data.details();
    var productTotals = data.productTotals();
    var branchTotals = data.branchTotals();
    try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("订单汇总");
      String[] headers = {"订单编号", "状态", "来源", "客户类型", "大区", "分公司", "经销商", "电话", "版本", "订货箱数", "订货吨数", "订单金额", "首次提交", "最后提交", "最后修改"};
      Row header = sheet.createRow(0); for (int i = 0; i < headers.length; i++) header.createCell(i).setCellValue(headers[i]);
      int rowNo = 1;
      for (OrderSummary order : orders) {
        Row row = sheet.createRow(rowNo++); int i = 0;
        Object[] values = {order.orderNo(), order.status(), sourceLabel(order.createdSource()), order.customerType(), order.regionCode(), order.branchName(), order.dealerFullName(),
            order.phone(), order.currentVersion(), order.totalQuantity(), order.totalTons(), order.totalAmount(), order.firstSubmittedAt(), order.lastSubmittedAt(), order.lastModifiedAt()};
        for (Object value : values) row.createCell(i++).setCellValue(value == null ? "" : value.toString());
      }
      for (int i = 0; i < headers.length; i++) sheet.autoSizeColumn(i);
      Sheet detailSheet = workbook.createSheet("订单商品明细");
      String[] detailHeaders = {"订单编号", "状态", "来源", "客户类型", "大区", "分公司", "经销商", "电话", "订单版本", "行号", "物料代码", "物料名称", "产品线", "规格", "箱规", "订货箱数", "计价模式", "基础箱价", "基础价箱数", "阶梯箱价", "阶梯箱数", "阶梯起订箱数", "是否命中阶梯", "金额", "吨数", "最后提交"};
      writeHeaders(detailSheet, detailHeaders);
      int detailRowNo = 1;
      for (Map<String, Object> item : details) {
        writeValues(detailSheet.createRow(detailRowNo++), item.get("order_no"), item.get("status"), sourceLabel(item.get("created_source")), item.get("customer_type"),
            item.get("region_code"), item.get("branch_name_snapshot"), item.get("dealer_full_name_snapshot"),
            item.get("phone"),
            item.get("current_version_no"), item.get("line_no"), item.get("material_code"), item.get("material_name"), item.get("product_line"),
            item.get("specification"), item.get("case_pack"), item.get("quantity"), item.get("pricing_mode"), item.get("base_case_price"),
            item.get("base_price_quantity"), item.get("tier_case_price"), item.get("tier_price_quantity"), item.get("tier_min_quantity"),
            item.get("applied_tier_min_quantity") == null ? "否" : "是", item.get("line_amount"),
            item.get("line_tons"), item.get("last_submitted_at"));
      }
      Sheet productSheet = workbook.createSheet("有效商品汇总");
      writeHeaders(productSheet, new String[]{"物料代码", "物料名称", "产品线", "规格", "箱规", "订货箱数", "订货金额", "订货吨数", "下单客户数"});
      int productRowNo = 1;
      for (Map<String, Object> item : productTotals) writeValues(productSheet.createRow(productRowNo++), item.get("material_code"), item.get("material_name"),
          item.get("product_line"), item.get("specification"), item.get("case_pack"), item.get("total_quantity"), item.get("total_amount"),
          item.get("total_tons"), item.get("order_count"));
      Sheet branchSheet = workbook.createSheet("有效分公司汇总");
      writeHeaders(branchSheet, new String[]{"大区", "分公司", "有效订单数", "订货箱数", "订货吨数", "订单金额"});
      int branchRowNo = 1;
      for (Map<String, Object> item : branchTotals) writeValues(branchSheet.createRow(branchRowNo++), item.get("region_code"), item.get("branch_name_snapshot"),
          item.get("order_count"), item.get("total_quantity"), item.get("total_tons"), item.get("total_amount"));
      workbook.write(output); return output.toByteArray();
    } catch (Exception exception) { throw new IllegalStateException("订单导出失败", exception); }
  }


  private static void writeHeaders(Sheet sheet, String[] headers) {
    Row row = sheet.createRow(0);
    for (int i = 0; i < headers.length; i++) row.createCell(i).setCellValue(headers[i]);
    sheet.createFreezePane(0, 1);
  }

  private static void writeValues(Row row, Object... values) {
    for (int i = 0; i < values.length; i++) row.createCell(i).setCellValue(values[i] == null ? "" : values[i].toString());
  }

  private static String sourceLabel(Object source) {
    return "ADMIN".equals(source == null ? null : source.toString()) ? "管理员" : "客户";
  }

}
