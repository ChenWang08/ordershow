package com.fengyi.ordershow.catalog;

import static com.fengyi.ordershow.catalog.ProductImageMatcher.*;
import com.fengyi.ordershow.catalog.ProductService.*;
import com.fengyi.ordershow.catalog.ProductCatalogReader.VersionSource;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.storage.StorageService;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;


@Service
public class ProductImageService {
  private static final Set<String> IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "webp", "gif", "bmp");
  private static final int MAX_IMAGES_PER_PRODUCT = 10;
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final StorageService storage;
  private final ProductCatalogReader catalog;
  public ProductImageService(JdbcTemplate jdbc, ActivityService activities, StorageService storage, ProductCatalogReader catalog) {
    this.jdbc = jdbc; this.activities = activities; this.storage = storage; this.catalog = catalog;
  }
  public ImageView addImage(long activityId, long productId, MultipartFile file, boolean primary, long adminId) {
    requireImageWritable(activityId);
    ProductView product = catalog.product(activityId, productId);
    validateImage(file.getOriginalFilename(), file.getSize());
    List<ProductView> targets = sameMaterialNameProducts(activityId, product);
    for (ProductView target : targets) {
      Integer current = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL", Integer.class, target.id());
      if (current != null && current >= MAX_IMAGES_PER_PRODUCT) {
        throw DomainException.unprocessable("PRODUCT_IMAGE_LIMIT", "每个商品最多配置 " + MAX_IMAGES_PER_PRODUCT + " 张图片");
      }
    }
    String materialName = materialNameKey(product.materialName());
    if (!materialName.isBlank()) {
      VersionSource source = catalog.currentSource(activityId);
      jdbc.update("""
          UPDATE product_image_review_candidate
          SET status = 'EXCLUDED', resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
          WHERE activity_id = ? AND data_version_id = ? AND normalized_material_name = ? AND status = 'PENDING'
          """, adminId, activityId, source.versionId(), materialName);
    }
    StorageService.StoredFile stored = storage.save(activityId, file, "PRODUCT_IMAGE", adminId);
    for (ProductView target : targets) {
      Integer current = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL", Integer.class, target.id());
      boolean makePrimary = primary || current == null || current == 0;
      if (makePrimary) {
        jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", target.id());
      }
      jdbc.update("""
          INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
          VALUES (?, ?, ?, ?, 'MANUAL', 'CONFIRMED', ?)
          ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = VALUES(is_primary), sort_no = VALUES(sort_no),
            source_type = 'MANUAL', match_status = 'CONFIRMED', created_by = VALUES(created_by)
          """, target.id(), stored.id(), makePrimary, current == null ? 0 : current, adminId);
    }
    ProductCatalogChanges.products(jdbc, activityId, targets.stream().map(ProductView::id).toList());
    return jdbc.queryForObject("""
        SELECT id, stored_file_id, is_primary, sort_no, source_type, match_status
        FROM product_image WHERE activity_product_id = ? AND stored_file_id = ? AND deleted_at IS NULL
        """, (rs, rowNum) -> new ImageView(rs.getLong("id"), rs.getLong("stored_file_id"),
        "/api/v1/public/files/" + rs.getLong("stored_file_id"), rs.getBoolean("is_primary"), rs.getInt("sort_no"),
        rs.getString("source_type"), rs.getString("match_status")), productId, stored.id());
  }

  public void updateImage(long activityId, long productId, long imageId, Boolean primary, Integer sortNo) {
    requireImageWritable(activityId);
    catalog.product(activityId, productId);
    if (Boolean.TRUE.equals(primary)) jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", productId);
    int changed = jdbc.update("UPDATE product_image SET is_primary = COALESCE(?, is_primary), sort_no = COALESCE(?, sort_no) WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL",
        primary, sortNo, imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
    ProductCatalogChanges.products(jdbc, activityId, List.of(productId));
  }

  public void deleteImage(long activityId, long productId, long imageId) {
    requireImageWritable(activityId);
    ProductView current = catalog.product(activityId, productId);
    List<Long> storedFileIds = jdbc.queryForList("SELECT stored_file_id FROM product_image WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL", Long.class, imageId, productId);
    if (storedFileIds.isEmpty()) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
    long storedFileId = storedFileIds.getFirst();
    int changed = jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL", imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
    List<ProductView> targets = sameMaterialNameProducts(activityId, current);
    for (ProductView target : targets) {
      if (target.id() != productId) {
        jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE activity_product_id = ? AND stored_file_id = ? AND deleted_at IS NULL", target.id(), storedFileId);
      }
    }
    ensurePrimaryImages(targets);
    ProductCatalogChanges.products(jdbc, activityId, targets.stream().map(ProductView::id).toList());
  }

  private List<ProductView> sameMaterialNameProducts(long activityId, ProductView product) {
    String name = materialNameKey(product.materialName());
    if (name.isBlank()) return List.of(product);
    VersionSource source = catalog.currentSource(activityId);
    return catalog.productsForVersion(activityId, source.versionId()).stream()
        .filter(candidate -> materialNameKey(candidate.materialName()).equals(name)).toList();
  }

  public List<ImageReviewView> pendingImageReviews(long activityId) {
    return pendingImageReviews(activityId, null);
  }

  public List<ImageReviewView> pendingImageReviews(long activityId, List<String> names) {
    if (names != null && names.isEmpty()) return List.of();
    var keys = names == null ? List.<String>of() : names.stream().map(ProductImageMatcher::materialNameKey).distinct().toList();
    if (keys.size() > 500) {
      List<ImageReviewView> result = new ArrayList<>();
      for (int start = 0; start < keys.size(); start += 500) result.addAll(pendingImageReviews(activityId, keys.subList(start, Math.min(start + 500, keys.size()))));
      return result;
    }
    List<Object> args = new ArrayList<>(); args.add(activityId); args.addAll(keys);
    String filter = names == null ? "" : " AND c.normalized_material_name IN (" + String.join(",", java.util.Collections.nCopies(keys.size(), "?")) + ")";
    return jdbc.query("""
        SELECT c.id, c.stored_file_id, c.archive_path, c.material_code, c.material_name, c.status
        FROM product_image_review_candidate c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'PRODUCT' AND b.current_version_id = c.data_version_id
        WHERE c.activity_id = ? AND c.status = 'PENDING'
        """ + filter + " ORDER BY c.normalized_material_name, c.id", (rs, rowNum) -> new ImageReviewView(rs.getLong("id"), rs.getLong("stored_file_id"),
        "/api/v1/public/files/" + rs.getLong("stored_file_id"), rs.getString("archive_path"),
        rs.getString("material_code"), rs.getString("material_name"), rs.getString("status")), args.toArray());
  }

  public void selectImageReview(long activityId, long candidateId, long adminId) {
    requireImageWritable(activityId);
    ImageReviewRow candidate = currentImageReview(activityId, candidateId);
    List<ProductView> targets = catalog.productsForVersion(activityId, candidate.versionId()).stream()
        .filter(product -> materialNameKey(product.materialName()).equals(candidate.materialNameKey())).toList();
    if (targets.isEmpty()) throw DomainException.conflict("IMAGE_REVIEW_PRODUCT_MISSING", "当前商品版本中已不存在该商品名称");
    for (ProductView target : targets) {
      Integer current = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL", Integer.class, target.id());
      Integer linked = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND stored_file_id = ? AND deleted_at IS NULL", Integer.class, target.id(), candidate.storedFileId());
      if ((current != null && current >= MAX_IMAGES_PER_PRODUCT) && (linked == null || linked == 0)) {
        throw DomainException.unprocessable("PRODUCT_IMAGE_LIMIT", "每个商品最多配置 " + MAX_IMAGES_PER_PRODUCT + " 张图片");
      }
    }
    jdbc.update("""
        UPDATE product_image_review_candidate SET status = 'EXCLUDED', resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
        WHERE data_version_id = ? AND (normalized_material_name = ? OR stored_file_id = ?) AND status = 'PENDING'
        """, adminId, candidate.versionId(), candidate.materialNameKey(), candidate.storedFileId());
    jdbc.update("UPDATE product_image_review_candidate SET status = 'SELECTED' WHERE id = ?", candidateId);
    for (ProductView target : targets) {
      jdbc.update("UPDATE product_image SET is_primary = FALSE, sort_no = sort_no + 1 WHERE activity_product_id = ? AND deleted_at IS NULL", target.id());
      jdbc.update("""
          INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
          VALUES (?, ?, TRUE, 0, 'ZIP_IMPORT', 'CONFIRMED', ?)
          ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = TRUE, sort_no = 0, match_status = 'CONFIRMED', created_by = VALUES(created_by)
          """, target.id(), candidate.storedFileId(), adminId);
    }
    ProductCatalogChanges.products(jdbc, activityId, targets.stream().map(ProductView::id).toList());
  }

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

  public ZipPreview previewZip(long activityId, MultipartFile zip, boolean confirm, long adminId) {
    if (confirm) requireImageWritable(activityId);
    if (zip.getSize() > 150L * 1024 * 1024) throw DomainException.badRequest("IMAGE_ZIP_TOO_LARGE", "图片 ZIP 不能超过 150MB");
    try {
      return processZip(activityId, null, null, zip.getBytes(), catalog.adminProducts(activityId, null, null, null), confirm, adminId, List.of());
    } catch (DomainException exception) { throw exception; }
    catch (Exception exception) { throw DomainException.unprocessable("IMAGE_ZIP_INVALID", "图片 ZIP 解析失败：" + exception.getMessage()); }
  }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId) {
    return attachZipToVersion(activityId, versionId, archiveFileId, adminId, List.of());
  }

  public ZipPreview attachZipToVersion(long activityId, long versionId, long archiveFileId, long adminId, List<ZipDecision> decisions) {
    Long importTaskId = jdbc.queryForObject("SELECT source_import_task_id FROM import_publish_version WHERE id = ? AND activity_id = ?", Long.class, versionId, activityId);
    return processZip(activityId, versionId, importTaskId, storage.read(archiveFileId), catalog.productsForVersion(activityId, versionId), true, adminId,
        decisions == null ? List.of() : decisions);
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
                .map(ProductImageMatcher::materialNameKey).anyMatch(name -> name.equals(materialNameKey(product.materialName())))).toList()
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
            int primaryCount = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL AND is_primary = TRUE", Integer.class, candidate.id());
            boolean makePrimary = current == 0 || primaryCount == 0;
            if (makePrimary) jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", candidate.id());
            jdbc.update("""
                INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
                VALUES (?, ?, ?, ?, 'ZIP_IMPORT', ?, ?)
                ON DUPLICATE KEY UPDATE deleted_at = NULL, is_primary = VALUES(is_primary), sort_no = VALUES(sort_no),
                  source_type = 'ZIP_IMPORT', match_status = VALUES(match_status), created_by = VALUES(created_by)
            """,
                candidate.id(), storedId, makePrimary, current, status, adminId);
          }
        }
        if (confirm && decision != null && "PENDING".equals(decision.status()) && versionId != null && importTaskId != null) {
          long storedId = storeZipImage(activityId, entry.getName(), content, digest, adminId);
          for (String targetName : decision.targetMaterialNames().stream().map(ProductImageMatcher::materialNameKey).filter(name -> !name.isBlank()).distinct().toList()) {
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
      if (confirm && versionId == null) ProductCatalogChanges.products(jdbc, activityId, products.stream().map(ProductView::id).toList());
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

  private static byte[] readLimited(ZipInputStream input, int max) throws Exception {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192]; int total = 0, read;
    while ((read = input.read(buffer)) >= 0) { total += read; if (total > max) throw DomainException.badRequest("IMAGE_TOO_LARGE", "ZIP 内单张图片不能超过 10MB"); output.write(buffer, 0, read); }
    return output.toByteArray();
  }

  private static boolean isImage(String name) { int dot = name.lastIndexOf('.'); return dot > 0 && IMAGE_EXTENSIONS.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT)); }

  private static String contentType(String name) { String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT); return switch (ext) { case "png" -> "image/png"; case "webp" -> "image/webp"; case "gif" -> "image/gif"; case "bmp" -> "image/bmp"; default -> "image/jpeg"; }; }

  private static void validateImage(String name, long size) { if (name == null || !isImage(name)) throw DomainException.badRequest("IMAGE_TYPE_INVALID", "仅支持 JPG、PNG、WEBP、GIF、BMP"); if (size > 10L * 1024 * 1024) throw DomainException.badRequest("IMAGE_TOO_LARGE", "单张图片不能超过 10MB"); }

  private void requireImageWritable(long activityId) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    String status = activities.byId(activityId).status();
    if ("CLOSED".equals(status) || "ARCHIVED".equals(status)) throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动已截止或归档，商品图片只读");
    if ("SCHEDULED".equals(status)) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后商品图片已锁定，请先撤回发布");
  }

  private record ImageReviewRow(long id, long versionId, long storedFileId, String materialNameKey) {}
}
