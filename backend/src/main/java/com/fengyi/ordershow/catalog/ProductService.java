package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.catalog.ProductCatalogReader.VersionSource;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.ProductBusinessKey;
import com.fengyi.ordershow.order.TonnageSyncService;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ProductService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final ProductCatalogReader catalog;
  private final ProductImageService images;
  private final com.fengyi.ordershow.order.PriceSyncService prices;
  private final TonnageSyncService tonnage;

  public ProductService(JdbcTemplate jdbc, ActivityService activities, ProductCatalogReader catalog, ProductImageService images,
                        com.fengyi.ordershow.order.PriceSyncService prices, TonnageSyncService tonnage) {
    this.jdbc = jdbc;
    this.activities = activities;
    this.catalog = catalog;
    this.images = images;
    this.prices = prices;
    this.tonnage = tonnage;
  }

  public List<ProductView> h5Products(String activityCode, H5Principal customer, String rebateStatus, String keyword) { return catalog.h5Products(activityCode, customer, rebateStatus, keyword); }

  public List<ProductView> adminProducts(long activityId, String customerType, String status, String keyword) { return catalog.adminProducts(activityId, customerType, status, keyword); }

  public List<ProductView> adminProducts(long activityId, String customerType, String status, String keyword,
                                         Long activityCustomerId) { return catalog.adminProducts(activityId, customerType, status, keyword, activityCustomerId); }

  @Transactional
  public ProductView update(long activityId, long productId, int expectedVersion, ProductPatch patch) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    var activity = activities.byId(activityId);
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后商品只读");
    if ("SCHEDULED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品已锁定，请先撤回发布");
    ProductView current = product(activityId, productId);
    if (patch.dealerScope() != null || patch.branchScope() != null || patch.customerType() != null) requireEditReason(activity.status(), patch.reason());
    List<String> branchScopes = patch.branchScope() == null ? current.branchScope() : splitBranchScope(patch.branchScope());
    String name = value(patch.materialName(), current.materialName());
    BigDecimal casePrice = patch.casePriceSet() ? com.fengyi.ordershow.common.ProductCompleteness.positive(patch.casePrice()) : current.casePrice();
    PriceTierView priceTier = patch.priceTierSet()
        ? validatePriceTier(casePrice, patch.priceTierMinQuantity(), patch.priceTierCasePrice(), patch.priceTierPricingMode())
        : validatePriceTier(casePrice, current.priceTier() == null ? null : current.priceTier().minQuantity(),
            current.priceTier() == null ? null : current.priceTier().casePrice(),
            current.priceTier() == null ? null : current.priceTier().pricingMode());
    BigDecimal factor = patch.tonCaseFactorSet() ? com.fengyi.ordershow.common.ProductCompleteness.positive(patch.tonCaseFactor()) : current.tonCaseFactor();
    String customerType = normalizeCustomerType(patch.customerType(), current.customerType());
    String rebateStatus = normalizeRebateStatus(patch.rebateStatus(), current.rebateStatus());
    String materialCode = choose(patch.materialCode(), current.materialCode());
    validateTypes(customerType, rebateStatus);
    VersionSource source = catalog.currentSource(activityId);
    ensureNoProductIdentityConflict(activityId, source.versionId(), productId, customerType, rebateStatus, name, materialCode);
    boolean visible = patch.visible() == null ? current.visible() : patch.visible();
    boolean orderable = patch.orderable() == null ? current.orderable() : patch.orderable();
    if (orderable && (!visible || casePrice == null || casePrice.signum() <= 0)) {
      throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "可订商品必须可见且元/箱大于 0");
    }
    try {
      int changed = jdbc.update("""
        UPDATE activity_product SET customer_type = ?, rebate_status = ?, business_key = ?, material_code = ?, material_name = ?, description = ?, category_name = ?, product_line = ?, brand_name = ?,
          variety_name = ?, specification = ?, case_pack = ?, bottle_price = ?, case_price = ?, ton_case_factor = ?,
          is_gift_box = ?, is_branch_customized = ?, is_visible = ?, is_orderable = ?, data_status = ?, lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND lock_version = ?
        """, customerType, rebateStatus, businessKey(customerType, rebateStatus, name, materialCode),
        materialCode, name, choose(patch.description(), current.description()), choose(patch.categoryName(), current.categoryName()),
        choose(patch.productLine(), current.productLine()), choose(patch.brandName(), current.brandName()),
        choose(patch.varietyName(), current.varietyName()), choose(patch.specification(), current.specification()),
        choose(patch.casePack(), current.casePack()), patch.bottlePriceSet() ? patch.bottlePrice() : current.bottlePrice(),
        casePrice, factor, patch.giftBox() == null ? current.giftBox() : patch.giftBox(), !branchScopes.isEmpty(), visible, orderable,
        com.fengyi.ordershow.common.ProductCompleteness.incomplete(casePrice, factor) ? "INCOMPLETE" : "ACTIVE",
        productId, activityId, expectedVersion);
      if (changed != 1) throw DomainException.conflict("PRODUCT_VERSION_CONFLICT", "商品已被其他页面修改，请刷新后重试");
      replaceBranchScopes(productId, branchScopes);
      new ProductDealerScopeService(jdbc).replace(activityId, productId, customerType, branchScopes, patch.dealerScope());
      new ProductDealerScopeService(jdbc).pruneBranches(productId, branchScopes);
      if (patch.priceTierSet()) replacePriceTier(productId, priceTier);
      if (!samePrice(casePrice,current.casePrice()) || !sameTier(priceTier,current.priceTier())) {
        prices.sync(activityId,productId,casePrice,priceTier==null?null:priceTier.minQuantity(),priceTier==null?null:priceTier.casePrice(),priceTier==null?null:priceTier.pricingMode());
      }
      if (!samePrice(factor, current.tonCaseFactor())) tonnage.sync(activityId, productId, factor);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", duplicateProductMessage());
    }
    ProductCatalogChanges.products(jdbc, activityId, List.of(productId));
    return product(activityId, productId);
  }

  @Transactional
  public ProductView create(long activityId, ProductCreate request) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    var activity = activities.byId(activityId);
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后商品只读");
    if ("SCHEDULED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品已锁定，请先撤回发布");
    String customerType = normalizeCustomerType(request.customerType(), "ALL");
    String rebateStatus = normalizeRebateStatus(request.rebateStatus(), "ALL");
    validateTypes(customerType, rebateStatus);
    String name = value(request.materialName(), "");
    if (name.isBlank()) throw DomainException.badRequest("PRODUCT_NAME_REQUIRED", "物料名称不能为空");
    BigDecimal casePrice = com.fengyi.ordershow.common.ProductCompleteness.positive(request.casePrice());
    BigDecimal factor = com.fengyi.ordershow.common.ProductCompleteness.positive(request.tonCaseFactor());
    boolean visible = request.visible() == null || request.visible();
    boolean orderable = request.orderable() == null ? visible && casePrice != null && casePrice.signum() > 0 : request.orderable();
    requireEditReason(activity.status(), request.reason());
    List<String> branchScopes = splitBranchScope(request.branchScope());
    if (orderable && (!visible || casePrice == null || casePrice.signum() <= 0)) {
      throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "可订商品必须可见且元/箱大于 0");
    }
    PriceTierView priceTier = validatePriceTier(casePrice, request.priceTierMinQuantity(), request.priceTierCasePrice(), request.priceTierPricingMode());
    VersionSource source = catalog.currentSource(activityId);
    String code = choose(request.materialCode(), null);
    ensureNoProductIdentityConflict(activityId, source.versionId(), null, customerType, rebateStatus, name, code);
    try {
      jdbc.update("""
          INSERT INTO activity_product(activity_id, customer_type, rebate_status, business_key, material_code, material_name, description,
            category_name, product_line, brand_name, variety_name, specification, case_pack, bottle_price, case_price,
            ton_case_factor, is_gift_box, is_branch_customized, is_visible, is_orderable, sort_no, data_status,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(p.sort_no), 0) + 1 FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ?),
            ?, ?, ?)
          """, activityId, customerType, rebateStatus, businessKey(customerType, rebateStatus, name, code), code, name, choose(request.description(), null),
          choose(request.categoryName(), null), choose(request.productLine(), null), choose(request.brandName(), null),
          choose(request.varietyName(), null), choose(request.specification(), null), choose(request.casePack(), null),
          request.bottlePrice(), casePrice, factor, Boolean.TRUE.equals(request.giftBox()), !branchScopes.isEmpty(), visible, orderable,
          activityId, source.versionId(), com.fengyi.ordershow.common.ProductCompleteness.incomplete(casePrice, factor) ? "INCOMPLETE" : "ACTIVE", source.taskId(), source.versionId());
      Long id = jdbc.queryForObject("SELECT id FROM activity_product WHERE activity_id = ? AND data_version_id = ? AND business_key = ?",
          Long.class, activityId, source.versionId(), businessKey(customerType, rebateStatus, name, code));
      if (id != null) replaceBranchScopes(id, branchScopes);
      if (id != null) new ProductDealerScopeService(jdbc).replace(activityId, id, customerType, branchScopes, request.dealerScope());
      if (id != null) replacePriceTier(id, priceTier);
      if (id != null) ProductCatalogChanges.products(jdbc, activityId, List.of(id));
      return product(activityId, id);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", duplicateProductMessage());
    }
  }

  @Transactional
  public void delete(long activityId, long productId, int expectedVersion) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    var activity = activities.byId(activityId);
    if (!"DRAFT".equals(activity.status())) {
      throw DomainException.conflict("ACTIVITY_IMPORT_LOCKED", "活动发布后不能删除商品");
    }
    int changed = jdbc.update("""
        UPDATE activity_product
        SET is_visible = FALSE, is_orderable = FALSE, deactivated_at = UTC_TIMESTAMP(3), lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND is_visible = TRUE AND lock_version = ?
        """, productId, activityId, expectedVersion);
    if (changed != 1) throw DomainException.conflict("PRODUCT_VERSION_CONFLICT", "商品已被删除或发生变化，请刷新后重试");
    ProductCatalogChanges.products(jdbc, activityId, List.of(productId));
  }

  @Transactional
  public ImageView addImage(long activityId, long productId, MultipartFile file, boolean primary, long adminId) { return images.addImage(activityId, productId, file, primary, adminId); }

  @Transactional
  public void updateImage(long activityId, long productId, long imageId, Boolean primary, Integer sortNo) { images.updateImage(activityId, productId, imageId, primary, sortNo); }

  @Transactional
  public void deleteImage(long activityId, long productId, long imageId) { images.deleteImage(activityId, productId, imageId); }


  public List<ImageReviewView> pendingImageReviews(long activityId) { return images.pendingImageReviews(activityId); }

  @Transactional
  public void selectImageReview(long activityId, long candidateId, long adminId) { images.selectImageReview(activityId, candidateId, adminId); }

  @Transactional
  public void excludeImageReview(long activityId, long candidateId, long adminId) { images.excludeImageReview(activityId, candidateId, adminId); }


  @Transactional
  public ZipPreview previewZip(long activityId, MultipartFile zip, boolean confirm, long adminId) { return images.previewZip(activityId, zip, confirm, adminId); }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId) { return images.attachZipToVersion(activityId, versionId, archiveFileId, adminId); }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId, List<ZipDecision> decisions) { return images.attachZipToVersion(activityId, versionId, archiveFileId, adminId, decisions); }








  public ProductView product(long activityId, long productId) { return catalog.product(activityId, productId); }






  private void replaceBranchScopes(long productId, List<String> branchScopes) {
    jdbc.update("DELETE FROM activity_product_branch_scope WHERE activity_product_id = ?", productId);
    for (String branch : branchScopes) {
      jdbc.update("""
          INSERT INTO activity_product_branch_scope(activity_product_id, branch_name, normalized_branch_name)
          VALUES (?, ?, ?)
          """, productId, branch, normalize(branch));
    }
  }

  private void replacePriceTier(long productId, PriceTierView priceTier) {
    jdbc.update("DELETE FROM activity_product_price_tier WHERE activity_product_id = ?", productId);
    if (priceTier != null) jdbc.update("""
        INSERT INTO activity_product_price_tier(activity_product_id, min_quantity, case_price, pricing_mode) VALUES (?, ?, ?, ?)
        """, productId, priceTier.minQuantity(), priceTier.casePrice(), priceTier.pricingMode());
  }

  public static PriceTierView validatePriceTier(BigDecimal basePrice, Long minQuantity, BigDecimal tierPrice, String pricingMode) {
    if (minQuantity == null && tierPrice == null) return null;
    if (minQuantity == null || tierPrice == null) {
      throw DomainException.unprocessable("PRODUCT_PRICE_TIER_INCOMPLETE", "请同时填写阶梯起订箱数和阶梯箱价");
    }
    if (minQuantity < 2 || minQuantity > 999_999) {
      throw DomainException.unprocessable("PRODUCT_PRICE_TIER_QUANTITY_INVALID", "阶梯起订箱数必须为 2 至 999999 的整数");
    }
    if (basePrice == null || basePrice.signum() <= 0 || tierPrice.signum() <= 0 || tierPrice.compareTo(basePrice) >= 0) {
      throw DomainException.unprocessable("PRODUCT_PRICE_TIER_PRICE_INVALID", "阶梯箱价必须大于 0 且低于基础箱价");
    }
    String mode = pricingMode == null || pricingMode.isBlank() ? "WHOLE_ORDER" : pricingMode;
    if (!Set.of("WHOLE_ORDER", "INCREMENTAL").contains(mode)) {
      throw DomainException.unprocessable("PRODUCT_PRICE_TIER_MODE_INVALID", "阶梯计价模式不正确");
    }
    return new PriceTierView(minQuantity, tierPrice, mode);
  }

  private static boolean samePrice(BigDecimal a, BigDecimal b) {
    return a == null || b == null ? a == b : a.compareTo(b) == 0;
  }
  private static boolean sameTier(PriceTierView a, PriceTierView b) {
    return a == null || b == null ? a == b : a.minQuantity() == b.minQuantity()
        && samePrice(a.casePrice(), b.casePrice()) && a.pricingMode().equals(b.pricingMode());
  }

  private static List<String> splitBranchScope(String value) {
    if (value == null || value.isBlank()) return List.of();
    Map<String, String> unique = new LinkedHashMap<>();
    for (String raw : value.split("[，,、]")) {
      String branch = raw.trim();
      if (!branch.isBlank()) unique.putIfAbsent(normalize(branch), branch);
    }
    return List.copyOf(unique.values());
  }

  private static void requireEditReason(String activityStatus, String reason) {
    if ("ACTIVE".equals(activityStatus) && (reason == null || reason.isBlank())) {
      throw DomainException.badRequest("PRODUCT_EDIT_REASON_REQUIRED", "活动开始后修改商品必须填写原因");
    }
  }

  private void ensureNoProductIdentityConflict(long activityId, long versionId, Long excludedProductId,
      String customerType, String rebateStatus, String materialName, String materialCode) {
    List<ProductIdentity> products = jdbc.query("""
        SELECT id, customer_type, rebate_status, material_name, material_code
        FROM activity_product WHERE activity_id = ? AND data_version_id = ?
        """, (rs, rowNum) -> new ProductIdentity(rs.getLong("id"), rs.getString("customer_type"),
        rs.getString("rebate_status"), rs.getString("material_name"), rs.getString("material_code")), activityId, versionId);
    for (ProductIdentity product : products) {
      if (excludedProductId != null && excludedProductId == product.id()) continue;
      if (ProductBusinessKey.conflicts(customerType, rebateStatus, materialName, materialCode,
          product.customerType(), product.rebateStatus(), product.materialName(), product.materialCode())) {
        throw DomainException.conflict("PRODUCT_EXISTS", duplicateProductMessage());
      }
    }
  }

  private static String duplicateProductMessage() {
    return "同一客户类型、同一返利类型下，同名且物料代码相同的商品已存在；任一物料代码为空时按名称判重";
  }

  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", ""); }
  private static String value(String requested, String current) { return requested == null ? current : requested.trim(); }
  private static String choose(String requested, String current) { return requested == null ? current : requested.isBlank() ? null : requested.trim(); }
  private static String businessKey(String customerType, String rebateStatus, String name, String materialCode) {
    return ProductBusinessKey.businessKey(customerType, rebateStatus, name, materialCode);
  }
  private static void validateTypes(String customerType, String rebateStatus) {
    if (!Set.of("GENERAL", "SPECIAL", "ALL").contains(customerType)) throw DomainException.badRequest("PRODUCT_CUSTOMER_TYPE_INVALID", "商品客户类型不正确");
    if (!Set.of("PARTICIPATING", "NOT_PARTICIPATING", "ALL").contains(rebateStatus)) throw DomainException.badRequest("PRODUCT_REBATE_INVALID", "商品返利类型不正确");
  }
  private static String normalizeCustomerType(String requested, String current) {
    return requested == null || requested.isBlank() ? current : requested.trim();
  }
  private static String normalizeRebateStatus(String requested, String current) {
    return requested == null || requested.isBlank() ? current : requested.trim();
  }

  public record ProductView(long id, String materialCode, String materialName, String description, String categoryName, String productLine,
      String brandName, String varietyName, String specification, String casePack, BigDecimal bottlePrice, BigDecimal casePrice,
      BigDecimal tonCaseFactor, String customerType, String rebateStatus, boolean giftBox, boolean visible, boolean orderable,
      String dataStatus, int sortNo, int version, List<ImageView> images, List<String> branchScope, PriceTierView priceTier) {}
  public record PriceTierView(long minQuantity, BigDecimal casePrice, String pricingMode) {}
  public record ImageView(long id, long fileId, String url, boolean primary, int sortNo, String sourceType, String matchStatus) {}
  public record ProductPatch(String customerType, String rebateStatus, String materialCode, String materialName, String description, String categoryName, String productLine, String brandName,
      String varietyName, String specification, String casePack, BigDecimal bottlePrice, boolean bottlePriceSet,
      BigDecimal casePrice, boolean casePriceSet, BigDecimal tonCaseFactor, boolean tonCaseFactorSet,
      Boolean giftBox, Boolean visible, Boolean orderable, String branchScope, String reason,
      Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode, boolean priceTierSet,
      List<ProductDealerScopeService.Selection> dealerScope) {}
  public record ProductCreate(String customerType, String rebateStatus, String materialCode, String materialName, String description,
      String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack,
      BigDecimal bottlePrice, BigDecimal casePrice, BigDecimal tonCaseFactor, Boolean giftBox, Boolean visible, Boolean orderable,
      String branchScope, String reason, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode,
      List<ProductDealerScopeService.Selection> dealerScope) {}
  public record ZipMatch(String filename, String materialName, Long productId, String status) {}
  public record ZipPreview(int imageCount, int matchedCount, int ambiguousCount, int unmatchedCount, List<ZipMatch> matches, boolean committed) {}
  public record ZipDecision(String entryPath, String status, List<String> targetMaterialNames) {}
  public record ImageReviewView(long id, long fileId, String url, String archivePath, String materialCode, String materialName, String status) {}
  private record ProductIdentity(long id, String customerType, String rebateStatus, String materialName, String materialCode) {}
}
