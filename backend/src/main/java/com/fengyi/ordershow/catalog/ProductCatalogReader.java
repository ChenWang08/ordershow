package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.catalog.ProductService.*;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;


@Service
public class ProductCatalogReader {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  public ProductCatalogReader(JdbcTemplate jdbc, ActivityService activities) { this.jdbc = jdbc; this.activities = activities; }
  public List<ProductView> h5Products(String activityCode, H5Principal customer, String rebateStatus, String keyword) {
    var activity = activities.byCode(activityCode);
    if (activity.id() != customer.activityId()) throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动");
    Long version = currentVersion(activity.id());
    if (version == null) return List.of();
    String sql = """
        SELECT p.* FROM activity_product p
        WHERE p.activity_id = ? AND p.data_version_id = ? AND (? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL') AND p.is_visible = TRUE
          AND (? IS NULL OR ? = '' OR p.rebate_status = ? OR p.rebate_status = 'ALL')
          AND (? IS NULL OR ? = '' OR p.material_name LIKE CONCAT('%', ?, '%') OR p.material_code LIKE CONCAT('%', ?, '%'))
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
        ORDER BY p.sort_no, p.id
        """;
    return jdbc.query(sql, this::map, activity.id(), version, customer.customerType(), customer.customerType(), rebateStatus, rebateStatus, rebateStatus,
        keyword, keyword, keyword, keyword, normalize(customer.branchName())).stream().map(this::withImages).toList();
  }

  public List<ProductView> adminProducts(long activityId, String customerType, String status, String keyword) {
    return adminProducts(activityId, customerType, status, keyword, null);
  }

  public List<ProductView> adminProducts(long activityId, String customerType, String status, String keyword,
                                         Long activityCustomerId) {
    Long version = currentVersion(activityId);
    if (version == null) return List.of();
    CustomerScope customer = activityCustomerId == null ? null : customerScope(activityId, activityCustomerId);
    String resolvedCustomerType = customer == null ? customerType : customer.customerType();
    String resolvedBranchName = customer == null ? null : normalize(customer.branchName());
    Boolean orderableOnly = customer == null ? null : Boolean.TRUE;
    return jdbc.query("""
        SELECT p.* FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ? AND p.is_visible = TRUE
          AND (? IS NULL OR ? = '' OR ? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL')
          AND (? IS NULL OR ? = '' OR p.data_status = ?)
          AND (? IS NULL OR p.is_orderable = TRUE)
          AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
            OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
          AND (? IS NULL OR ? = '' OR p.material_name LIKE CONCAT('%', ?, '%') OR p.material_code LIKE CONCAT('%', ?, '%'))
        ORDER BY p.sort_no, p.id
        """, this::map, activityId, version, resolvedCustomerType, resolvedCustomerType, resolvedCustomerType, resolvedCustomerType,
        status, status, status, orderableOnly, resolvedBranchName, resolvedBranchName,
        keyword, keyword, keyword, keyword).stream().map(this::withImages).toList();
  }

  List<ProductView> productsForVersion(long activityId, long versionId) {
    return jdbc.query("""
        SELECT p.* FROM activity_product p
        WHERE p.activity_id = ? AND p.data_version_id = ? AND p.is_visible = TRUE
        ORDER BY p.sort_no, p.id
        """, this::map, activityId, versionId);
  }

  public ProductView product(long activityId, long productId) {
    List<ProductView> rows = jdbc.query("SELECT * FROM activity_product WHERE id = ? AND activity_id = ?", this::map, productId, activityId);
    if (rows.size() != 1) throw DomainException.notFound("PRODUCT_NOT_FOUND", "商品不存在");
    return withImages(rows.getFirst());
  }

  Long currentVersion(long activityId) {
    return jdbc.query("SELECT current_version_id FROM activity_data_binding WHERE activity_id = ? AND data_type = 'PRODUCT'",
        rs -> rs.next() ? rs.getLong(1) : null, activityId);
  }

  CustomerScope customerScope(long activityId, long activityCustomerId) {
    return jdbc.query("""
        SELECT c.customer_type, c.branch_name
        FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE c.id = ? AND c.activity_id = ? AND c.is_active = TRUE AND c.data_version_id = b.current_version_id
        """, (rs, rowNum) -> new CustomerScope(rs.getString("customer_type"), rs.getString("branch_name")),
        activityCustomerId, activityId).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("CUSTOMER_NOT_FOUND", "当前活动客户不存在或已失效"));
  }

  VersionSource currentSource(long activityId) {
    return jdbc.query("""
        SELECT v.id, v.source_import_task_id FROM activity_data_binding b
        JOIN import_publish_version v ON v.id = b.current_version_id
        WHERE b.activity_id = ? AND b.data_type = 'PRODUCT'
        """, (rs, rowNum) -> new VersionSource(rs.getLong(1), rs.getLong(2)), activityId).stream().findFirst()
        .orElseThrow(() -> DomainException.conflict("DATA_VERSION_REQUIRED", "请先发布一次商品 Excel，再手动维护商品"));
  }

  ProductView withImages(ProductView product) {
    List<ImageView> images = jdbc.query("""
        SELECT i.id, i.stored_file_id, i.is_primary, i.sort_no, i.source_type, i.match_status FROM product_image i
        WHERE i.activity_product_id = ? AND i.deleted_at IS NULL ORDER BY i.is_primary DESC, i.sort_no, i.id
        """, (rs, rowNum) -> new ImageView(rs.getLong(1), rs.getLong(2), "/api/v1/public/files/" + rs.getLong(2),
        rs.getBoolean(3), rs.getInt(4), rs.getString(5), rs.getString(6)), product.id());
    List<String> branchScope = jdbc.query("""
        SELECT branch_name FROM activity_product_branch_scope
        WHERE activity_product_id = ? ORDER BY id
        """, (rs, rowNum) -> rs.getString(1), product.id());
    PriceTierView priceTier = jdbc.query("""
        SELECT min_quantity, case_price, pricing_mode FROM activity_product_price_tier WHERE activity_product_id = ?
        """, (rs, rowNum) -> new PriceTierView(rs.getLong(1), rs.getBigDecimal(2), rs.getString(3)), product.id())
        .stream().findFirst().orElse(null);
    return new ProductView(product.id(), product.materialCode(), product.materialName(), product.description(), product.categoryName(), product.productLine(),
        product.brandName(), product.varietyName(), product.specification(), product.casePack(), product.bottlePrice(), product.casePrice(),
        product.tonCaseFactor(), product.customerType(), product.rebateStatus(), product.giftBox(), product.visible(), product.orderable(),
        product.dataStatus(), product.sortNo(), product.version(), images, branchScope, priceTier);
  }

  ProductView map(ResultSet rs, int rowNum) throws SQLException {
    return new ProductView(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("description"),
        rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"),
        rs.getString("specification"), rs.getString("case_pack"), rs.getBigDecimal("bottle_price"), rs.getBigDecimal("case_price"),
        rs.getBigDecimal("ton_case_factor"), rs.getString("customer_type"), rs.getString("rebate_status"),
        rs.getBoolean("is_gift_box"), rs.getBoolean("is_visible"), rs.getBoolean("is_orderable"), rs.getString("data_status"),
        rs.getInt("sort_no"), rs.getInt("lock_version"), List.of(), List.of(), null);
  }

  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", ""); }

  record VersionSource(long versionId, long taskId) {}
  private record CustomerScope(String customerType, String branchName) {}
}
