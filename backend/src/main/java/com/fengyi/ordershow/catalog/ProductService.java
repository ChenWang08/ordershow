package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import com.fengyi.ordershow.storage.StorageService;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ProductService {
  private static final Set<String> IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "webp", "gif", "bmp");
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final StorageService storage;

  public ProductService(JdbcTemplate jdbc, ActivityService activities, StorageService storage) {
    this.jdbc = jdbc;
    this.activities = activities;
    this.storage = storage;
  }

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
    Long version = currentVersion(activityId);
    if (version == null) return List.of();
    return jdbc.query("""
        SELECT p.* FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ? AND p.is_visible = TRUE
          AND (? IS NULL OR ? = '' OR p.customer_type = ? OR p.customer_type = 'ALL')
          AND (? IS NULL OR ? = '' OR p.data_status = ?)
          AND (? IS NULL OR ? = '' OR p.material_name LIKE CONCAT('%', ?, '%') OR p.material_code LIKE CONCAT('%', ?, '%'))
        ORDER BY p.sort_no, p.id
        """, this::map, activityId, version, customerType, customerType, customerType, status, status, status,
        keyword, keyword, keyword, keyword).stream().map(this::withImages).toList();
  }

  @Transactional
  public ProductView update(long activityId, long productId, int expectedVersion, ProductPatch patch) {
    var activity = activities.byId(activityId);
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后商品只读");
    if ("SCHEDULED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品已锁定，请先撤回发布");
    requireEditReason(activity.status(), patch.reason());
    ProductView current = product(activityId, productId);
    List<String> branchScopes = patch.branchScope() == null ? current.branchScope() : splitBranchScope(patch.branchScope());
    String name = value(patch.materialName(), current.materialName());
    BigDecimal casePrice = patch.casePriceSet() ? patch.casePrice() : current.casePrice();
    PriceTierView priceTier = patch.priceTierSet()
        ? validatePriceTier(casePrice, patch.priceTierMinQuantity(), patch.priceTierCasePrice(), patch.priceTierPricingMode())
        : validatePriceTier(casePrice, current.priceTier() == null ? null : current.priceTier().minQuantity(),
            current.priceTier() == null ? null : current.priceTier().casePrice(),
            current.priceTier() == null ? null : current.priceTier().pricingMode());
    BigDecimal factor = patch.tonCaseFactorSet() ? patch.tonCaseFactor() : current.tonCaseFactor();
    String customerType = normalizeCustomerType(patch.customerType(), current.customerType());
    String rebateStatus = normalizeRebateStatus(patch.rebateStatus(), current.rebateStatus());
    validateTypes(customerType, rebateStatus);
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
        """, customerType, rebateStatus, businessKey(customerType, rebateStatus, name),
        choose(patch.materialCode(), current.materialCode()), name, choose(patch.description(), current.description()), choose(patch.categoryName(), current.categoryName()),
        choose(patch.productLine(), current.productLine()), choose(patch.brandName(), current.brandName()),
        choose(patch.varietyName(), current.varietyName()), choose(patch.specification(), current.specification()),
        choose(patch.casePack(), current.casePack()), patch.bottlePriceSet() ? patch.bottlePrice() : current.bottlePrice(),
        casePrice, factor, patch.giftBox() == null ? current.giftBox() : patch.giftBox(), !branchScopes.isEmpty(), visible, orderable,
        incomplete(name, casePrice, factor,
            patch.specification() == null ? current.specification() : patch.specification(),
            patch.casePack() == null ? current.casePack() : patch.casePack()) ? "INCOMPLETE" : "ACTIVE",
        productId, activityId, expectedVersion);
      if (changed != 1) throw DomainException.conflict("PRODUCT_VERSION_CONFLICT", "商品已被其他页面修改，请刷新后重试");
      replaceBranchScopes(productId, branchScopes);
      if (patch.priceTierSet()) replacePriceTier(productId, priceTier);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", "当前商品目录已存在相同客户类型、返利类型和商品名称");
    }
    return product(activityId, productId);
  }

  @Transactional
  public ProductView create(long activityId, ProductCreate request) {
    var activity = activities.byId(activityId);
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后商品只读");
    if ("SCHEDULED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品已锁定，请先撤回发布");
    String customerType = normalizeCustomerType(request.customerType(), "ALL");
    String rebateStatus = normalizeRebateStatus(request.rebateStatus(), "ALL");
    validateTypes(customerType, rebateStatus);
    String name = value(request.materialName(), "");
    if (name.isBlank()) throw DomainException.badRequest("PRODUCT_NAME_REQUIRED", "物料名称不能为空");
    boolean visible = request.visible() == null || request.visible();
    boolean orderable = request.orderable() == null ? visible && request.casePrice() != null && request.casePrice().signum() > 0 : request.orderable();
    requireEditReason(activity.status(), request.reason());
    List<String> branchScopes = splitBranchScope(request.branchScope());
    if (orderable && (!visible || request.casePrice() == null || request.casePrice().signum() <= 0)) {
      throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "可订商品必须可见且元/箱大于 0");
    }
    PriceTierView priceTier = validatePriceTier(request.casePrice(), request.priceTierMinQuantity(), request.priceTierCasePrice(), request.priceTierPricingMode());
    VersionSource source = currentSource(activityId);
    String code = choose(request.materialCode(), null);
    try {
      jdbc.update("""
          INSERT INTO activity_product(activity_id, customer_type, rebate_status, business_key, material_code, material_name, description,
            category_name, product_line, brand_name, variety_name, specification, case_pack, bottle_price, case_price,
            ton_case_factor, is_gift_box, is_branch_customized, is_visible, is_orderable, sort_no, data_status,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(p.sort_no), 0) + 1 FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ?),
            ?, ?, ?)
          """, activityId, customerType, rebateStatus, businessKey(customerType, rebateStatus, name), code, name, choose(request.description(), null),
          choose(request.categoryName(), null), choose(request.productLine(), null), choose(request.brandName(), null),
          choose(request.varietyName(), null), choose(request.specification(), null), choose(request.casePack(), null),
          request.bottlePrice(), request.casePrice(), request.tonCaseFactor(), Boolean.TRUE.equals(request.giftBox()), !branchScopes.isEmpty(), visible, orderable,
          activityId, source.versionId(), incomplete(name, request.casePrice(), request.tonCaseFactor(),
          request.specification(), request.casePack()) ? "INCOMPLETE" : "ACTIVE", source.taskId(), source.versionId());
      Long id = jdbc.queryForObject("SELECT id FROM activity_product WHERE activity_id = ? AND data_version_id = ? AND business_key = ?",
          Long.class, activityId, source.versionId(), businessKey(customerType, rebateStatus, name));
      if (id != null) replaceBranchScopes(id, branchScopes);
      if (id != null) replacePriceTier(id, priceTier);
      return product(activityId, id);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", "当前商品目录已存在相同客户类型、返利类型和商品名称");
    }
  }

  @Transactional
  public void delete(long activityId, long productId, int expectedVersion) {
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
  }

  @Transactional
  public ImageView addImage(long activityId, long productId, MultipartFile file, boolean primary, long adminId) {
    requireImageWritable(activityId);
    ProductView product = product(activityId, productId);
    validateImage(file.getOriginalFilename(), file.getSize());
    List<ProductView> targets = sameMaterialNameProducts(activityId, product);
    String materialName = materialNameKey(product.materialName());
    if (!materialName.isBlank()) {
      VersionSource source = currentSource(activityId);
      jdbc.update("""
          UPDATE product_image_review_candidate
          SET status = 'EXCLUDED', resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
          WHERE activity_id = ? AND data_version_id = ? AND normalized_material_name = ? AND status = 'PENDING'
          """, adminId, activityId, source.versionId(), materialName);
    }
    StorageService.StoredFile stored = storage.save(activityId, file, "PRODUCT_IMAGE", adminId);
    for (ProductView target : targets) {
      jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", target.id());
      jdbc.update("""
          INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
          VALUES (?, ?, TRUE, 0, 'MANUAL', 'CONFIRMED', ?)
          ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = TRUE, sort_no = 0,
            source_type = 'MANUAL', match_status = 'CONFIRMED', created_by = VALUES(created_by)
          """, target.id(), stored.id(), adminId);
    }
    Long imageId = jdbc.queryForObject("SELECT id FROM product_image WHERE activity_product_id = ? AND stored_file_id = ?", Long.class, productId, stored.id());
    return new ImageView(imageId, stored.id(), "/api/v1/public/files/" + stored.id(), true, 0, "MANUAL", "CONFIRMED");
  }

  @Transactional
  public void updateImage(long activityId, long productId, long imageId, Boolean primary, Integer sortNo) {
    requireImageWritable(activityId);
    product(activityId, productId);
    if (Boolean.TRUE.equals(primary)) jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", productId);
    int changed = jdbc.update("UPDATE product_image SET is_primary = COALESCE(?, is_primary), sort_no = COALESCE(?, sort_no) WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL",
        primary, sortNo, imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
  }

  @Transactional
  public void deleteImage(long activityId, long productId, long imageId) {
    requireImageWritable(activityId);
    ProductView current = product(activityId, productId);
    int changed = jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL", imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
    for (ProductView target : sameMaterialNameProducts(activityId, current)) {
      jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", target.id());
    }
  }

  private List<ProductView> sameMaterialNameProducts(long activityId, ProductView product) {
    String name = materialNameKey(product.materialName());
    if (name.isBlank()) return List.of(product);
    VersionSource source = currentSource(activityId);
    return productsForVersion(activityId, source.versionId()).stream()
        .filter(candidate -> materialNameKey(candidate.materialName()).equals(name)).toList();
  }

  public List<ImageReviewView> pendingImageReviews(long activityId) {
    return jdbc.query("""
        SELECT c.id, c.stored_file_id, c.archive_path, c.material_code, c.material_name, c.status
        FROM product_image_review_candidate c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'PRODUCT' AND b.current_version_id = c.data_version_id
        WHERE c.activity_id = ? AND c.status = 'PENDING'
        ORDER BY c.normalized_material_name, c.id
        """, (rs, rowNum) -> new ImageReviewView(rs.getLong("id"), rs.getLong("stored_file_id"),
        "/api/v1/public/files/" + rs.getLong("stored_file_id"), rs.getString("archive_path"),
        rs.getString("material_code"), rs.getString("material_name"), rs.getString("status")), activityId);
  }

  @Transactional
  public void selectImageReview(long activityId, long candidateId, long adminId) {
    requireImageWritable(activityId);
    ImageReviewRow candidate = currentImageReview(activityId, candidateId);
    List<ProductView> targets = productsForVersion(activityId, candidate.versionId()).stream()
        .filter(product -> materialNameKey(product.materialName()).equals(candidate.materialNameKey())).toList();
    if (targets.isEmpty()) throw DomainException.conflict("IMAGE_REVIEW_PRODUCT_MISSING", "当前商品版本中已不存在该商品名称");
    jdbc.update("""
        UPDATE product_image_review_candidate SET status = 'EXCLUDED', resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
        WHERE data_version_id = ? AND (normalized_material_name = ? OR stored_file_id = ?) AND status = 'PENDING'
        """, adminId, candidate.versionId(), candidate.materialNameKey(), candidate.storedFileId());
    jdbc.update("UPDATE product_image_review_candidate SET status = 'SELECTED' WHERE id = ?", candidateId);
    for (ProductView target : targets) {
      jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", target.id());
      jdbc.update("""
          INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
          VALUES (?, ?, TRUE, 0, 'ZIP_IMPORT', 'CONFIRMED', ?)
          ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = TRUE, sort_no = 0, match_status = 'CONFIRMED', created_by = VALUES(created_by)
          """, target.id(), candidate.storedFileId(), adminId);
    }
  }

  @Transactional
  public void excludeImageReview(long activityId, long candidateId, long adminId) {
    requireImageWritable(activityId);
    ImageReviewRow candidate = currentImageReview(activityId, candidateId);
    int changed = jdbc.update("""
        UPDATE product_image_review_candidate SET status = 'EXCLUDED', resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND status = 'PENDING'
        """, adminId, candidateId);
    if (changed != 1) throw DomainException.conflict("IMAGE_REVIEW_STATE_CHANGED", "图片候选已被其他操作处理，请刷新后重试");
  }

  private ImageReviewRow currentImageReview(long activityId, long candidateId) {
    List<ImageReviewRow> rows = jdbc.query("""
        SELECT c.id, c.data_version_id, c.stored_file_id, c.normalized_material_name
        FROM product_image_review_candidate c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'PRODUCT' AND b.current_version_id = c.data_version_id
        WHERE c.activity_id = ? AND c.id = ? AND c.status = 'PENDING' FOR UPDATE
        """, (rs, rowNum) -> new ImageReviewRow(rs.getLong("id"), rs.getLong("data_version_id"),
        rs.getLong("stored_file_id"), rs.getString("normalized_material_name")), activityId, candidateId);
    if (rows.size() != 1) throw DomainException.notFound("IMAGE_REVIEW_NOT_FOUND", "待确认图片不存在或已经处理");
    return rows.getFirst();
  }

  @Transactional
  public ZipPreview previewZip(long activityId, MultipartFile zip, boolean confirm, long adminId) {
    if (zip.getSize() > 150L * 1024 * 1024) throw DomainException.badRequest("IMAGE_ZIP_TOO_LARGE", "图片 ZIP 不能超过 150MB");
    try {
      return processZip(activityId, null, null, zip.getBytes(), adminProducts(activityId, null, null, null), confirm, adminId, List.of());
    } catch (DomainException exception) { throw exception; }
    catch (Exception exception) { throw DomainException.unprocessable("IMAGE_ZIP_INVALID", "图片 ZIP 解析失败：" + exception.getMessage()); }
  }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId) {
    return attachZipToVersion(activityId, versionId, archiveFileId, adminId, List.of());
  }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId, List<ZipDecision> decisions) {
    Long importTaskId = jdbc.queryForObject("SELECT source_import_task_id FROM import_publish_version WHERE id = ? AND activity_id = ?", Long.class, versionId, activityId);
    return processZip(activityId, versionId, importTaskId, storage.read(archiveFileId), productsForVersion(activityId, versionId), true, adminId,
        decisions == null ? List.of() : decisions);
  }

  private List<ProductView> productsForVersion(long activityId, long versionId) {
    return jdbc.query("""
        SELECT p.* FROM activity_product p
        WHERE p.activity_id = ? AND p.data_version_id = ? AND p.is_visible = TRUE
        ORDER BY p.sort_no, p.id
        """, this::map, activityId, versionId);
  }

  private ZipPreview processZip(long activityId, Long versionId, Long importTaskId, byte[] zipBytes, List<ProductView> products, boolean confirm, long adminId,
                                List<ZipDecision> decisions) {
    if (confirm) {
      for (ProductView product : products) {
        jdbc.update("""
            UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE
            WHERE activity_product_id = ? AND source_type = 'ZIP_IMPORT' AND deleted_at IS NULL
            """, product.id());
      }
    }
    int images = 0, matched = 0, ambiguous = 0, unmatched = 0;
    List<ZipMatch> matches = new ArrayList<>();
    boolean explicitDecisionMode = !decisions.isEmpty();
    Map<String, ZipDecision> decisionsByPath = decisions.stream().collect(java.util.stream.Collectors.toMap(
        decision -> normalizeArchivePath(decision.entryPath()), decision -> decision, (first, ignored) -> first));
    Set<String> hashes = new HashSet<>();
    try (ZipInputStream input = new ZipInputStream(new ByteArrayInputStream(zipBytes), StandardCharsets.UTF_8)) {
      ZipEntry entry;
      while ((entry = input.getNextEntry()) != null) {
        if (entry.isDirectory() || !isImage(entry.getName())) continue;
        byte[] content = readLimited(input, 10 * 1024 * 1024);
        images++;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
        String hash = java.util.HexFormat.of().formatHex(digest);
        if (!hashes.add(hash)) continue;
        String materialName = baseName(entry.getName());
        ZipDecision decision = decisionsByPath.get(normalizeArchivePath(entry.getName()));
        // 一旦管理端提交了整批决定，未出现在决定清单中的 ZIP 图片也不得在 Worker 阶段重新自动匹配。
        ImageCandidates match = decision == null && !explicitDecisionMode
            ? imageCandidates(entry.getName(), products) : new ImageCandidates(List.of(), false);
        List<ProductView> candidates = decision != null && "CONFIRMED".equals(decision.status())
            ? products.stream().filter(product -> decision.targetMaterialNames().stream()
                .map(ProductService::materialNameKey).anyMatch(name -> name.equals(materialNameKey(product.materialName())))).toList()
            : match.products();
        String status;
        Long productId = null;
        boolean explicitlyConfirmed = decision != null && "CONFIRMED".equals(decision.status());
        if (explicitlyConfirmed && candidates.isEmpty()) throw DomainException.unprocessable("IMAGE_DECISION_TARGET_MISSING", "已确认图片对应的商品不存在：" + entry.getName());
        if (!candidates.isEmpty() && (explicitlyConfirmed || !match.ambiguous())) { status = explicitlyConfirmed ? "CONFIRMED" : "MATCHED"; productId = candidates.getFirst().id(); matched++; }
        else if ((decision != null && "PENDING".equals(decision.status())) || (decision == null && match.ambiguous())) { status = "AMBIGUOUS"; ambiguous++; }
        else { status = "UNMATCHED"; unmatched++; }
        if (confirm && productId != null) {
          long storedId = storeZipImage(activityId, entry.getName(), content, digest, adminId);
          for (ProductView candidate : candidates) {
            Integer alreadyLinked = jdbc.queryForObject("""
                SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND stored_file_id = ? AND deleted_at IS NULL
                """, Integer.class, candidate.id(), storedId);
            if (alreadyLinked != null && alreadyLinked > 0) continue;
            int current = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL", Integer.class, candidate.id());
            jdbc.update("""
                INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
                VALUES (?, ?, ?, ?, 'ZIP_IMPORT', ?, ?)
                ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = VALUES(is_primary), sort_no = VALUES(sort_no),
                  source_type = 'ZIP_IMPORT', match_status = VALUES(match_status), created_by = VALUES(created_by)
            """,
                candidate.id(), storedId, current == 0, current, status, adminId);
          }
        }
        if (confirm && decision != null && "PENDING".equals(decision.status()) && versionId != null && importTaskId != null) {
          long storedId = storeZipImage(activityId, entry.getName(), content, digest, adminId);
          for (String targetName : decision.targetMaterialNames().stream().map(ProductService::materialNameKey).filter(name -> !name.isBlank()).distinct().toList()) {
            List<ProductView> targetProducts = products.stream().filter(product -> materialNameKey(product.materialName()).equals(targetName)).toList();
            String candidateMaterialName = targetProducts.stream()
                .map(ProductView::materialName).findFirst().orElse("");
            String candidateMaterialCode = targetProducts.stream().map(ProductView::materialCode).filter(code -> code != null && !code.isBlank()).findFirst().orElse("");
            jdbc.update("""
                INSERT INTO product_image_review_candidate(activity_id, data_version_id, import_task_id, stored_file_id,
                  archive_path, material_code, normalized_material_code, material_name, normalized_material_name, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
                ON DUPLICATE KEY UPDATE archive_path = VALUES(archive_path), material_code = VALUES(material_code),
                  normalized_material_code = VALUES(normalized_material_code), material_name = VALUES(material_name),
                  normalized_material_name = VALUES(normalized_material_name), status = 'PENDING',
                  resolved_by = NULL, resolved_at = NULL
                """, activityId, versionId, importTaskId, storedId, normalizeArchivePath(entry.getName()), candidateMaterialCode,
                materialCodeKey(candidateMaterialCode), candidateMaterialName, targetName);
          }
        }
        matches.add(new ZipMatch(entry.getName(), materialName, productId, status));
      }
      if (images == 0) throw DomainException.unprocessable("IMAGE_ZIP_EMPTY", "ZIP 中没有找到支持的商品图片");
      if (confirm) ensurePrimaryImages(products);
    } catch (DomainException exception) { throw exception; }
    catch (Exception exception) { throw DomainException.unprocessable("IMAGE_ZIP_INVALID", "图片 ZIP 解析失败：" + exception.getMessage()); }
    return new ZipPreview(images, matched, ambiguous, unmatched, matches, confirm);
  }

  private static String normalizeArchivePath(String value) {
    return value == null ? "" : value.replace('\\', '/').replaceAll("^/+", "").trim();
  }

  private long storeZipImage(long activityId, String filename, byte[] content, byte[] digest, long adminId) throws Exception {
    List<Long> existingFiles = jdbc.queryForList("""
        SELECT id FROM stored_file WHERE activity_id = ? AND file_purpose = 'PRODUCT_IMAGE'
          AND sha256 = ? AND deleted_at IS NULL ORDER BY id LIMIT 1
        """, Long.class, activityId, digest);
    return existingFiles.isEmpty()
        ? storage.save(activityId, filename, contentType(filename), content, "PRODUCT_IMAGE", adminId).id()
        : existingFiles.getFirst();
  }

  private static String materialCodeKey(String value) {
    return value == null ? "" : value.replaceAll("\\s+", "").toLowerCase(Locale.CHINA);
  }

  private static String materialNameKey(String value) {
    return imageMatchName(value);
  }

  private void ensurePrimaryImages(List<ProductView> products) {
    for (ProductView product : products) {
      Integer primaryCount = jdbc.queryForObject("""
          SELECT COUNT(*) FROM product_image
          WHERE activity_product_id = ? AND deleted_at IS NULL AND is_primary = TRUE
          """, Integer.class, product.id());
      if (primaryCount != null && primaryCount > 0) continue;
      List<Long> first = jdbc.queryForList("""
          SELECT id FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL
          ORDER BY sort_no, id LIMIT 1
          """, Long.class, product.id());
      if (!first.isEmpty()) jdbc.update("UPDATE product_image SET is_primary = TRUE WHERE id = ?", first.getFirst());
    }
  }

  static ImageCandidates imageCandidates(String filename, List<ProductView> products) {
    List<String> imageKeys = imagePathCandidates(filename).stream().map(ProductService::imageMatchName).filter(key -> !key.isBlank()).toList();
    if (imageKeys.isEmpty()) return new ImageCandidates(List.of(), false);
    Map<String, List<ProductView>> groups = products.stream()
        .collect(java.util.stream.Collectors.groupingBy(product -> imageMatchName(product.materialName())));
    for (String imageKey : imageKeys) {
      List<ProductView> exact = groups.get(imageKey);
      if (exact != null) return new ImageCandidates(exact, false);
    }

    double best = 0;
    List<String> bestKeys = new ArrayList<>();
    for (String productKey : groups.keySet()) {
      if (productKey.isBlank()) continue;
      double score = imageKeys.stream().mapToDouble(imageKey -> imageNameScore(imageKey, productKey)).max().orElse(0);
      if (score > best + 0.015) {
        best = score;
        bestKeys.clear();
        bestKeys.add(productKey);
      } else if (score >= best - 0.015 && score > 0) {
        bestKeys.add(productKey);
      }
    }
    if (best < 0.55 || bestKeys.isEmpty()) return new ImageCandidates(List.of(), false);
    if (best < 0.90 || bestKeys.size() > 1) return new ImageCandidates(List.of(), true);
    return new ImageCandidates(groups.get(bestKeys.getFirst()), false);
  }

  static double imageNameScore(String image, String product) {
    if (signaturesConflict(signature(image), signature(product))) return 0;
    if (image.equals(product)) return 1;
    String imageCore = withoutPackaging(image).replace("x", "");
    String productCore = withoutPackaging(product).replace("x", "");
    if (imageCore.equals(productCore)) return 0.98;
    if (image.contains(product) || product.contains(image)) {
      double ratio = (double) Math.min(image.length(), product.length()) / Math.max(image.length(), product.length());
      if (Math.min(image.length(), product.length()) >= 7 && ratio >= 0.5) return 0.91 + ratio * 0.08;
    }
    int distance = editDistance(image, product);
    return 1d - (double) distance / Math.max(image.length(), product.length());
  }

  private static int editDistance(String left, String right) {
    int[] previous = new int[right.length() + 1];
    for (int column = 0; column <= right.length(); column++) previous[column] = column;
    for (int row = 1; row <= left.length(); row++) {
      int[] current = new int[right.length() + 1];
      current[0] = row;
      for (int column = 1; column <= right.length(); column++) {
        int replace = previous[column - 1] + (left.charAt(row - 1) == right.charAt(column - 1) ? 0 : 1);
        current[column] = Math.min(Math.min(previous[column] + 1, current[column - 1] + 1), replace);
      }
      previous = current;
    }
    return previous[right.length()];
  }

  private static String imageMatchName(String value) {
    if (value == null) return "";
    String normalized = value.toLowerCase(Locale.CHINA)
        .replaceAll("^\\d{8}(?=[\\p{IsHan}])", "")
        .replaceAll("(?i)(主图|产品图|白底图|清图|组装好发货|天津定制|河南定制|北京定制|武汉分特渠|随货发)", "")
        .replaceAll("(?i)[\\-_]o$", "")
        .replace('×', 'x').replace('*', 'x')
        .replaceAll("[^\\p{IsHan}a-z0-9.]", "")
        .replaceAll("(主图|清)\\d*$", "");
    return normalized;
  }

  static List<String> imagePathCandidates(String path) {
    if (path == null) return List.of();
    List<String> segments = new ArrayList<>(java.util.Arrays.stream(path.replace('\\', '/').split("/"))
        .map(String::trim).filter(segment -> !segment.isBlank() && !segment.equals(".") && !segment.equals("..")).toList());
    if (segments.isEmpty()) return List.of();
    int last = segments.size() - 1;
    segments.set(last, segments.get(last).replaceFirst("(?i)\\.(jpg|jpeg|png|webp|gif|bmp)$", ""));
    java.util.LinkedHashSet<String> candidates = new java.util.LinkedHashSet<>();
    for (int start = 0; start < segments.size(); start++) {
      String candidate = String.join("", segments.subList(start, segments.size()));
      if (imageMatchName(candidate).length() >= 6) candidates.add(candidate);
    }
    return List.copyOf(candidates);
  }

  private static final List<String> IMAGE_VARIETIES = List.of(
      "清香米醋", "香甜米醋", "精酿陈醋", "山西陈醋", "镇江香醋", "酿造白醋", "零添加米醋",
      "零添加特级味极鲜", "零添加金标生抽", "蒸鱼豉油酱油", "蒸鱼豉油", "味极鲜酱油", "金标生抽", "薄盐生抽", "红烧老抽", "草菇老抽", "生抽", "老抽",
      "藤椒油", "花椒油", "小磨香油", "芝麻油", "调和油", "菜籽油", "玉米油", "葵花籽油",
      "白醋", "陈醋", "香醋", "米醋");
  private static final List<String> IMAGE_BRANDS = List.of("金龙鱼", "梁汾", "丸庄", "香满园", "胡姬花", "口福");
  private static final List<String> IMAGE_CATEGORIES = List.of("酱油", "陈醋", "香醋", "米醋", "白醋", "醋", "料酒", "蚝油", "调味油", "食用油");
  private static final List<String> IMAGE_GRADES = List.of("特级", "一级", "二级", "三级");

  private static ImageSignature signature(String value) {
    String normalized = imageMatchName(value);
    Set<String> volumes = new HashSet<>();
    java.util.regex.Matcher volumeMatcher = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)(ml|kg|l|g)").matcher(normalized);
    while (volumeMatcher.find()) {
      double amount = Double.parseDouble(volumeMatcher.group(1));
      String unit = volumeMatcher.group(2);
      double converted = unit.equals("l") || unit.equals("kg") ? amount * 1000 : amount;
      volumes.add(java.math.BigDecimal.valueOf(converted).stripTrailingZeros().toPlainString() + (unit.equals("l") || unit.equals("ml") ? "ml" : "g"));
    }
    Set<String> packs = regexTokens(normalized, "x(\\d+)", 1);
    packs.addAll(regexTokens(normalized, "(?:ml|kg|g|l)(\\d+)(?!\\d)", 1));
    String brand = longestContained(normalized, IMAGE_BRANDS);
    String category = longestContained(normalized, IMAGE_CATEGORIES).replaceAll("(?:陈|香|米|白)醋", "醋");
    String variety = IMAGE_VARIETIES.stream().filter(normalized::contains).max(java.util.Comparator.comparingInt(String::length)).orElse("");
    String grade = longestContained(normalized, IMAGE_GRADES);
    return new ImageSignature(volumes, packs, brand, category, variety, grade,
        namedTokens(normalized, Map.of("玻璃瓶", "glass", "塑料瓶", "pet", "pet瓶", "pet", "pe瓶", "pe", "pe壶", "pe", "铁罐", "metal")),
        namedTokens(normalized, Map.of("葫芦瓶", "gourd")),
        namedTokens(normalized, Map.of("纸箱", "carton", "礼盒", "gift", "塑料袋", "bag", "袋装", "bag", "散装", "bulk")));
  }

  private static String longestContained(String value, List<String> terms) {
    return terms.stream().filter(value::contains).max(java.util.Comparator.comparingInt(String::length)).orElse("");
  }

  private static Set<String> regexTokens(String value, String regex, int group) {
    Set<String> tokens = new HashSet<>();
    java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(regex).matcher(value);
    while (matcher.find()) tokens.add(matcher.group(group));
    return tokens;
  }

  private static Set<String> namedTokens(String value, Map<String, String> terms) {
    return terms.entrySet().stream().filter(entry -> value.contains(entry.getKey())).map(Map.Entry::getValue).collect(java.util.stream.Collectors.toSet());
  }

  private static boolean setsConflict(Set<String> first, Set<String> second) {
    return !first.isEmpty() && !second.isEmpty() && first.stream().noneMatch(second::contains);
  }

  private static boolean signaturesConflict(ImageSignature first, ImageSignature second) {
    return setsConflict(first.volumes(), second.volumes()) || setsConflict(first.packCounts(), second.packCounts())
        || (!first.brand().isBlank() && !second.brand().isBlank() && !first.brand().equals(second.brand()))
        || (!first.category().isBlank() && !second.category().isBlank() && !first.category().equals(second.category()))
        || (!first.variety().isBlank() && !second.variety().isBlank() && !first.variety().equals(second.variety()))
        || (!first.grade().isBlank() && !second.grade().isBlank() && !first.grade().equals(second.grade()))
        || setsConflict(first.containerMaterial(), second.containerMaterial())
        || setsConflict(first.containerShape(), second.containerShape())
        || setsConflict(first.outerPackaging(), second.outerPackaging());
  }

  private static String withoutPackaging(String value) {
    return value.replaceAll("(?i)(玻璃瓶|塑料瓶|塑料袋|纸箱|pe瓶|pe壶|pet瓶|pet|葫芦瓶|铁罐|礼盒随货发|礼盒随货|礼盒|袋装|散装)", "");
  }

  public ProductView product(long activityId, long productId) {
    List<ProductView> rows = jdbc.query("SELECT * FROM activity_product WHERE id = ? AND activity_id = ?", this::map, productId, activityId);
    if (rows.size() != 1) throw DomainException.notFound("PRODUCT_NOT_FOUND", "商品不存在");
    return withImages(rows.getFirst());
  }

  private Long currentVersion(long activityId) {
    return jdbc.query("SELECT current_version_id FROM activity_data_binding WHERE activity_id = ? AND data_type = 'PRODUCT'",
        rs -> rs.next() ? rs.getLong(1) : null, activityId);
  }

  private VersionSource currentSource(long activityId) {
    return jdbc.query("""
        SELECT v.id, v.source_import_task_id FROM activity_data_binding b
        JOIN import_publish_version v ON v.id = b.current_version_id
        WHERE b.activity_id = ? AND b.data_type = 'PRODUCT'
        """, (rs, rowNum) -> new VersionSource(rs.getLong(1), rs.getLong(2)), activityId).stream().findFirst()
        .orElseThrow(() -> DomainException.conflict("DATA_VERSION_REQUIRED", "请先发布一次商品 Excel，再手动维护商品"));
  }

  private ProductView withImages(ProductView product) {
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

  private ProductView map(ResultSet rs, int rowNum) throws SQLException {
    return new ProductView(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"), rs.getString("description"),
        rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"),
        rs.getString("specification"), rs.getString("case_pack"), rs.getBigDecimal("bottle_price"), rs.getBigDecimal("case_price"),
        rs.getBigDecimal("ton_case_factor"), rs.getString("customer_type"), rs.getString("rebate_status"),
        rs.getBoolean("is_gift_box"), rs.getBoolean("is_visible"), rs.getBoolean("is_orderable"), rs.getString("data_status"),
        rs.getInt("sort_no"), rs.getInt("lock_version"), List.of(), List.of(), null);
  }

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

  private static PriceTierView validatePriceTier(BigDecimal basePrice, Long minQuantity, BigDecimal tierPrice, String pricingMode) {
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

  private static byte[] readLimited(ZipInputStream input, int max) throws Exception {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192]; int total = 0, read;
    while ((read = input.read(buffer)) >= 0) { total += read; if (total > max) throw DomainException.badRequest("IMAGE_TOO_LARGE", "ZIP 内单张图片不能超过 10MB"); output.write(buffer, 0, read); }
    return output.toByteArray();
  }
  private static boolean isImage(String name) { int dot = name.lastIndexOf('.'); return dot > 0 && IMAGE_EXTENSIONS.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT)); }
  private static String baseName(String path) { String name = path.replace('\\', '/'); name = name.substring(name.lastIndexOf('/') + 1); int dot = name.lastIndexOf('.'); return (dot > 0 ? name.substring(0, dot) : name).trim(); }
  private static String contentType(String name) { String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT); return switch (ext) { case "png" -> "image/png"; case "webp" -> "image/webp"; case "gif" -> "image/gif"; case "bmp" -> "image/bmp"; default -> "image/jpeg"; }; }
  private static void validateImage(String name, long size) { if (name == null || !isImage(name)) throw DomainException.badRequest("IMAGE_TYPE_INVALID", "仅支持 JPG、PNG、WEBP、GIF、BMP"); if (size > 10L * 1024 * 1024) throw DomainException.badRequest("IMAGE_TOO_LARGE", "单张图片不能超过 10MB"); }
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

  private void requireImageWritable(long activityId) {
    String status = activities.byId(activityId).status();
    if ("CLOSED".equals(status)) throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动截止后商品图片只读");
    if ("SCHEDULED".equals(status)) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品图片已锁定，请先撤回发布");
  }

  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", ""); }
  private static String value(String requested, String current) { return requested == null ? current : requested.trim(); }
  private static String choose(String requested, String current) { return requested == null ? current : requested.isBlank() ? null : requested.trim(); }
  private static String businessKey(String customerType, String rebateStatus, String name) {
    return customerType + "|" + rebateStatus + "|" + normalize(name);
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
  private static boolean incomplete(String name, BigDecimal price, BigDecimal factor, String spec, String pack) { return name == null || name.isBlank() || price == null || factor == null || spec == null || spec.isBlank() || pack == null || pack.isBlank(); }

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
      Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode, boolean priceTierSet) {}
  public record ProductCreate(String customerType, String rebateStatus, String materialCode, String materialName, String description,
      String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack,
      BigDecimal bottlePrice, BigDecimal casePrice, BigDecimal tonCaseFactor, Boolean giftBox, Boolean visible, Boolean orderable,
      String branchScope, String reason, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode) {}
  public record ZipMatch(String filename, String materialName, Long productId, String status) {}
  public record ZipPreview(int imageCount, int matchedCount, int ambiguousCount, int unmatchedCount, List<ZipMatch> matches, boolean committed) {}
  public record ZipDecision(String entryPath, String status, List<String> targetMaterialNames) {}
  public record ImageReviewView(long id, long fileId, String url, String archivePath, String materialCode, String materialName, String status) {}
  private record ImageReviewRow(long id, long versionId, long storedFileId, String materialNameKey) {}
  private record ImageCandidates(List<ProductView> products, boolean ambiguous) {}
  private record ImageSignature(Set<String> volumes, Set<String> packCounts, String brand, String category, String variety, String grade,
                                Set<String> containerMaterial, Set<String> containerShape, Set<String> outerPackaging) {}
  private record VersionSource(long versionId, long taskId) {}
}
