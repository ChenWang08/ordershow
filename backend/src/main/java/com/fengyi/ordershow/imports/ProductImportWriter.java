package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportValues.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;


@Service
public class ProductImportWriter {
  private final JdbcTemplate jdbc;
  public ProductImportWriter(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  void write(long activityId, long taskId, long versionId, List<MaterializeRow> rows) {
    int sort = 0;
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      String name = text(data.get("materialName"));
      BigDecimal casePrice = decimal(data.get("casePrice"));
      BigDecimal factor = decimal(data.get("tonCaseFactor"));
      boolean visible = !name.isBlank();
      boolean orderable = visible && casePrice != null && casePrice.signum() > 0;
      String status = optionalProductMissing(data) ? "INCOMPLETE" : "ACTIVE";
      String businessKey = productKey(data);
      jdbc.update("""
          INSERT INTO activity_product(activity_id, customer_type, rebate_status, business_key, material_code, material_name, description,
            category_name, product_line, brand_name, variety_name, specification, case_pack, bottle_price, case_price,
            ton_case_factor, is_gift_box, is_branch_customized, is_visible, is_orderable, sort_no, data_status,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, activityId, text(data.get("customerType")), text(data.get("rebateStatus")), businessKey,
          nullableText(data.get("materialCode")), name, nullableText(data.get("description")), nullableText(data.get("categoryName")), nullableText(data.get("productLine")),
          nullableText(data.get("brandName")), nullableText(data.get("varietyName")), nullableText(data.get("specification")),
          nullableText(data.get("casePack")), decimal(data.get("bottlePrice")), casePrice, factor, bool(data.get("giftBox")),
          !text(data.get("branchScope")).isBlank(), visible, orderable, ++sort, status, taskId, versionId);
      Long productId = jdbc.queryForObject("SELECT id FROM activity_product WHERE activity_id = ? AND data_version_id = ? AND business_key = ?", Long.class, activityId, versionId, businessKey);
      if (productId != null) for (String branch : text(data.get("branchScope")).split("[，,、]")) {
        if (!branch.isBlank()) jdbc.update("INSERT INTO activity_product_branch_scope(activity_product_id, branch_name, normalized_branch_name) VALUES (?, ?, ?)", productId, branch.trim(), normalize(branch));
      }
      Long tierMinQuantity = integer(data.get("priceTierMinQuantity"));
      BigDecimal tierCasePrice = decimal(data.get("priceTierCasePrice"));
      String tierPricingMode = text(data.get("priceTierPricingMode"));
      if (tierPricingMode.isBlank()) tierPricingMode = "WHOLE_ORDER";
      if (productId != null && tierMinQuantity != null && tierCasePrice != null) {
        jdbc.update("INSERT INTO activity_product_price_tier(activity_product_id, min_quantity, case_price, pricing_mode) VALUES (?, ?, ?, ?)",
            productId, tierMinQuantity, tierCasePrice, tierPricingMode);
      }
    }
  }
}
