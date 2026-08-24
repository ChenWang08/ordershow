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
        WHERE p.activity_id = ? AND p.data_version_id = ? AND p.customer_type = ? AND p.is_visible = TRUE
          AND (? IS NULL OR ? = '' OR p.rebate_status = ?)
          AND (? IS NULL OR ? = '' OR p.material_name LIKE CONCAT('%', ?, '%') OR p.material_code LIKE CONCAT('%', ?, '%'))
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
        ORDER BY p.sort_no, p.id
        """;
    return jdbc.query(sql, this::map, activity.id(), version, customer.customerType(), rebateStatus, rebateStatus, rebateStatus,
        keyword, keyword, keyword, keyword, normalize(customer.branchName())).stream().map(this::withImages).toList();
  }

  public List<ProductView> adminProducts(long activityId, String customerType, String status, String keyword) {
    Long version = currentVersion(activityId);
    if (version == null) return List.of();
    return jdbc.query("""
        SELECT p.* FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ? AND p.is_visible = TRUE
          AND (? IS NULL OR ? = '' OR p.customer_type = ?)
          AND (? IS NULL OR ? = '' OR p.data_status = ?)
          AND (? IS NULL OR ? = '' OR p.material_name LIKE CONCAT('%', ?, '%') OR p.material_code LIKE CONCAT('%', ?, '%'))
        ORDER BY p.sort_no, p.id
        """, this::map, activityId, version, customerType, customerType, customerType, status, status, status,
        keyword, keyword, keyword, keyword).stream().map(this::withImages).toList();
  }

  @Transactional
  public ProductView update(long activityId, long productId, int expectedVersion, ProductPatch patch) {
    var activity = activities.byId(activityId);
    if ("CLOSED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动截止后商品只读");
    requireEditReason(activity.status(), patch.reason());
    ProductView current = product(activityId, productId);
    List<String> branchScopes = patch.branchScope() == null ? current.branchScope() : splitBranchScope(patch.branchScope());
    String name = value(patch.materialName(), current.materialName());
    BigDecimal casePrice = patch.casePriceSet() ? patch.casePrice() : current.casePrice();
    BigDecimal factor = patch.tonCaseFactorSet() ? patch.tonCaseFactor() : current.tonCaseFactor();
    String customerType = value(patch.customerType(), current.customerType());
    String rebateStatus = value(patch.rebateStatus(), current.rebateStatus());
    validateTypes(customerType, rebateStatus);
    boolean visible = patch.visible() == null ? current.visible() : patch.visible();
    boolean orderable = patch.orderable() == null ? current.orderable() : patch.orderable();
    if (orderable && (!visible || casePrice == null || casePrice.signum() <= 0)) {
      throw DomainException.unprocessable("PRODUCT_NOT_ORDERABLE", "可订商品必须可见且元/箱大于 0");
    }
    try {
      int changed = jdbc.update("""
        UPDATE activity_product SET customer_type = ?, rebate_status = ?, business_key = ?, material_code = ?, material_name = ?, category_name = ?, product_line = ?, brand_name = ?,
          variety_name = ?, specification = ?, case_pack = ?, bottle_price = ?, case_price = ?, ton_case_factor = ?,
          is_gift_box = ?, is_branch_customized = ?, is_visible = ?, is_orderable = ?, data_status = ?, lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND lock_version = ?
        """, customerType, rebateStatus, businessKey(customerType, rebateStatus, choose(patch.materialCode(), current.materialCode()), name),
        choose(patch.materialCode(), current.materialCode()), name, choose(patch.categoryName(), current.categoryName()),
        choose(patch.productLine(), current.productLine()), choose(patch.brandName(), current.brandName()),
        choose(patch.varietyName(), current.varietyName()), choose(patch.specification(), current.specification()),
        choose(patch.casePack(), current.casePack()), patch.bottlePriceSet() ? patch.bottlePrice() : current.bottlePrice(),
        casePrice, factor, patch.giftBox() == null ? current.giftBox() : patch.giftBox(), !branchScopes.isEmpty(), visible, orderable,
        incomplete(name, casePrice, factor, patch.materialCode() == null ? current.materialCode() : patch.materialCode(),
            patch.specification() == null ? current.specification() : patch.specification(),
            patch.casePack() == null ? current.casePack() : patch.casePack()) ? "INCOMPLETE" : "ACTIVE",
        productId, activityId, expectedVersion);
      if (changed != 1) throw DomainException.conflict("PRODUCT_VERSION_CONFLICT", "商品已被其他页面修改，请刷新后重试");
      replaceBranchScopes(productId, branchScopes);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", "当前商品目录已存在相同物料代码或同名商品");
    }
    return product(activityId, productId);
  }

  @Transactional
  public ProductView create(long activityId, ProductCreate request) {
    var activity = activities.byId(activityId);
    if ("CLOSED".equals(activity.status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动截止后商品只读");
    String customerType = value(request.customerType(), "GENERAL");
    String rebateStatus = value(request.rebateStatus(), "NOT_PARTICIPATING");
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
    VersionSource source = currentSource(activityId);
    String code = choose(request.materialCode(), null);
    try {
      jdbc.update("""
          INSERT INTO activity_product(activity_id, customer_type, rebate_status, business_key, material_code, material_name,
            category_name, product_line, brand_name, variety_name, specification, case_pack, bottle_price, case_price,
            ton_case_factor, is_gift_box, is_branch_customized, is_visible, is_orderable, sort_no, data_status,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(p.sort_no), 0) + 1 FROM activity_product p WHERE p.activity_id = ? AND p.data_version_id = ?),
            ?, ?, ?)
          """, activityId, customerType, rebateStatus, businessKey(customerType, rebateStatus, code, name), code, name,
          choose(request.categoryName(), null), choose(request.productLine(), null), choose(request.brandName(), null),
          choose(request.varietyName(), null), choose(request.specification(), null), choose(request.casePack(), null),
          request.bottlePrice(), request.casePrice(), request.tonCaseFactor(), Boolean.TRUE.equals(request.giftBox()), !branchScopes.isEmpty(), visible, orderable,
          activityId, source.versionId(), incomplete(name, request.casePrice(), request.tonCaseFactor(), code,
          request.specification(), request.casePack()) ? "INCOMPLETE" : "ACTIVE", source.taskId(), source.versionId());
      Long id = jdbc.queryForObject("SELECT id FROM activity_product WHERE activity_id = ? AND data_version_id = ? AND business_key = ?",
          Long.class, activityId, source.versionId(), businessKey(customerType, rebateStatus, code, name));
      if (id != null) replaceBranchScopes(id, branchScopes);
      return product(activityId, id);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("PRODUCT_EXISTS", "当前商品目录已存在相同物料代码或同名商品");
    }
  }

  @Transactional
  public void delete(long activityId, long productId, int expectedVersion) {
    var activity = activities.byId(activityId);
    if ("ACTIVE".equals(activity.status()) || "CLOSED".equals(activity.status())) {
      throw DomainException.conflict("ACTIVITY_IMPORT_LOCKED", "活动开始后不能删除商品");
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
    ProductView product = product(activityId, productId);
    validateImage(file.getOriginalFilename(), file.getSize());
    StorageService.StoredFile stored = storage.save(activityId, file, "PRODUCT_IMAGE", adminId);
    if (primary) jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", productId);
    jdbc.update("""
        INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by)
        VALUES (?, ?, ?, COALESCE((SELECT MAX(pi.sort_no) + 1 FROM product_image pi WHERE pi.activity_product_id = ?), 0), 'MANUAL', 'CONFIRMED', ?)
        """, productId, stored.id(), primary, productId, adminId);
    Long imageId = jdbc.queryForObject("SELECT id FROM product_image WHERE activity_product_id = ? AND stored_file_id = ?", Long.class, productId, stored.id());
    return new ImageView(imageId, stored.id(), "/api/v1/public/files/" + stored.id(), primary, 0);
  }

  @Transactional
  public void updateImage(long activityId, long productId, long imageId, Boolean primary, Integer sortNo) {
    product(activityId, productId);
    if (Boolean.TRUE.equals(primary)) jdbc.update("UPDATE product_image SET is_primary = FALSE WHERE activity_product_id = ? AND deleted_at IS NULL", productId);
    int changed = jdbc.update("UPDATE product_image SET is_primary = COALESCE(?, is_primary), sort_no = COALESCE(?, sort_no) WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL",
        primary, sortNo, imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
  }

  public void deleteImage(long activityId, long productId, long imageId) {
    product(activityId, productId);
    int changed = jdbc.update("UPDATE product_image SET deleted_at = UTC_TIMESTAMP(3), is_primary = FALSE WHERE id = ? AND activity_product_id = ? AND deleted_at IS NULL", imageId, productId);
    if (changed != 1) throw DomainException.notFound("PRODUCT_IMAGE_NOT_FOUND", "商品图片不存在");
  }

  public ZipPreview previewZip(long activityId, MultipartFile zip, boolean confirm, long adminId) {
    if (zip.getSize() > 150L * 1024 * 1024) throw DomainException.badRequest("IMAGE_ZIP_TOO_LARGE", "图片 ZIP 不能超过 150MB");
    List<ProductView> products = adminProducts(activityId, null, null, null);
    int images = 0, matched = 0, ambiguous = 0, unmatched = 0;
    List<ZipMatch> matches = new ArrayList<>();
    Set<String> hashes = new HashSet<>();
    try (ZipInputStream input = new ZipInputStream(new ByteArrayInputStream(zip.getBytes()), StandardCharsets.UTF_8)) {
      ZipEntry entry;
      while ((entry = input.getNextEntry()) != null) {
        if (entry.isDirectory() || !isImage(entry.getName())) continue;
        byte[] content = readLimited(input, 10 * 1024 * 1024);
        images++;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
        String hash = java.util.HexFormat.of().formatHex(digest);
        if (!hashes.add(hash)) continue;
        String materialName = baseName(entry.getName());
        ImageCandidates match = imageCandidates(materialName, products);
        List<ProductView> candidates = match.products();
        String status;
        Long productId = null;
        if (!candidates.isEmpty() && !match.ambiguous()) { status = "MATCHED"; productId = candidates.getFirst().id(); matched++; }
        else if (match.ambiguous()) { status = "AMBIGUOUS"; ambiguous++; }
        else { status = "UNMATCHED"; unmatched++; }
        if (confirm && productId != null) {
          List<Long> existingFiles = jdbc.queryForList("""
              SELECT id FROM stored_file WHERE activity_id = ? AND file_purpose = 'PRODUCT_IMAGE'
                AND sha256 = ? AND deleted_at IS NULL ORDER BY id LIMIT 1
              """, Long.class, activityId, digest);
          long storedId = existingFiles.isEmpty()
              ? storage.save(activityId, entry.getName(), contentType(entry.getName()), content, "PRODUCT_IMAGE", adminId).id()
              : existingFiles.getFirst();
          for (ProductView candidate : candidates) {
            Integer alreadyLinked = jdbc.queryForObject("""
                SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND stored_file_id = ? AND deleted_at IS NULL
                """, Integer.class, candidate.id(), storedId);
            if (alreadyLinked != null && alreadyLinked > 0) continue;
            int current = jdbc.queryForObject("SELECT COUNT(*) FROM product_image WHERE activity_product_id = ? AND deleted_at IS NULL", Integer.class, candidate.id());
            jdbc.update("INSERT INTO product_image(activity_product_id, stored_file_id, is_primary, sort_no, source_type, match_status, created_by) VALUES (?, ?, ?, ?, 'ZIP_IMPORT', 'MATCHED', ?)",
                candidate.id(), storedId, current == 0, current, adminId);
          }
        }
        matches.add(new ZipMatch(entry.getName(), materialName, productId, status));
      }
    } catch (DomainException exception) { throw exception; }
    catch (Exception exception) { throw DomainException.unprocessable("IMAGE_ZIP_INVALID", "图片 ZIP 解析失败：" + exception.getMessage()); }
    return new ZipPreview(images, matched, ambiguous, unmatched, matches, confirm);
  }

  private static ImageCandidates imageCandidates(String filename, List<ProductView> products) {
    String imageKey = imageMatchName(filename);
    if (imageKey.isBlank()) return new ImageCandidates(List.of(), false);
    Map<String, List<ProductView>> groups = products.stream()
        .collect(java.util.stream.Collectors.groupingBy(product -> imageMatchName(product.materialName())));
    List<ProductView> exact = groups.get(imageKey);
    if (exact != null) return new ImageCandidates(exact, false);

    double best = 0;
    List<String> bestKeys = new ArrayList<>();
    for (String productKey : groups.keySet()) {
      if (productKey.isBlank()) continue;
      double score = imageNameScore(imageKey, productKey);
      if (score > best + 0.015) {
        best = score;
        bestKeys.clear();
        bestKeys.add(productKey);
      } else if (score >= best - 0.015 && score > 0) {
        bestKeys.add(productKey);
      }
    }
    if (best < 0.74 || bestKeys.isEmpty()) return new ImageCandidates(List.of(), false);
    if (bestKeys.size() > 1) return new ImageCandidates(List.of(), true);
    return new ImageCandidates(groups.get(bestKeys.getFirst()), false);
  }

  private static double imageNameScore(String image, String product) {
    if (image.equals(product)) return 1;
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
        .replaceAll("(?i)(主图|产品图|白底图|清图|玻璃瓶|塑料瓶|塑料袋|纸箱|pet瓶|pe瓶|pe壶|铁罐|礼盒随货发|礼盒随货|随货发)", "")
        .replaceAll("(?i)[\\-_]o$", "")
        .replace('×', 'x').replace('*', 'x')
        .replaceAll("[^\\p{IsHan}a-z0-9.]", "")
        .replace("x", "")
        .replaceAll("(主图|清)\\d*$", "");
    return normalized;
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
        SELECT i.id, i.stored_file_id, i.is_primary, i.sort_no FROM product_image i
        WHERE i.activity_product_id = ? AND i.deleted_at IS NULL ORDER BY i.is_primary DESC, i.sort_no, i.id
        """, (rs, rowNum) -> new ImageView(rs.getLong(1), rs.getLong(2), "/api/v1/public/files/" + rs.getLong(2), rs.getBoolean(3), rs.getInt(4)), product.id());
    List<String> branchScope = jdbc.query("""
        SELECT branch_name FROM activity_product_branch_scope
        WHERE activity_product_id = ? ORDER BY id
        """, (rs, rowNum) -> rs.getString(1), product.id());
    return new ProductView(product.id(), product.materialCode(), product.materialName(), product.categoryName(), product.productLine(),
        product.brandName(), product.varietyName(), product.specification(), product.casePack(), product.bottlePrice(), product.casePrice(),
        product.tonCaseFactor(), product.customerType(), product.rebateStatus(), product.giftBox(), product.visible(), product.orderable(),
        product.dataStatus(), product.sortNo(), product.version(), images, branchScope);
  }

  private ProductView map(ResultSet rs, int rowNum) throws SQLException {
    return new ProductView(rs.getLong("id"), rs.getString("material_code"), rs.getString("material_name"),
        rs.getString("category_name"), rs.getString("product_line"), rs.getString("brand_name"), rs.getString("variety_name"),
        rs.getString("specification"), rs.getString("case_pack"), rs.getBigDecimal("bottle_price"), rs.getBigDecimal("case_price"),
        rs.getBigDecimal("ton_case_factor"), rs.getString("customer_type"), rs.getString("rebate_status"),
        rs.getBoolean("is_gift_box"), rs.getBoolean("is_visible"), rs.getBoolean("is_orderable"), rs.getString("data_status"),
        rs.getInt("sort_no"), rs.getInt("lock_version"), List.of(), List.of());
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

  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()]+", ""); }
  private static String value(String requested, String current) { return requested == null ? current : requested.trim(); }
  private static String choose(String requested, String current) { return requested == null ? current : requested.isBlank() ? null : requested.trim(); }
  private static String businessKey(String customerType, String rebateStatus, String code, String name) {
    String identity = code == null || code.isBlank() ? normalize(name) : code.trim().toLowerCase(Locale.CHINA);
    return customerType + "|" + rebateStatus + "|" + identity;
  }
  private static void validateTypes(String customerType, String rebateStatus) {
    if (!Set.of("GENERAL", "SPECIAL").contains(customerType)) throw DomainException.badRequest("PRODUCT_CUSTOMER_TYPE_INVALID", "商品客户类型不正确");
    if (!Set.of("PARTICIPATING", "NOT_PARTICIPATING").contains(rebateStatus)) throw DomainException.badRequest("PRODUCT_REBATE_INVALID", "商品返利类型不正确");
  }
  private static boolean incomplete(String name, BigDecimal price, BigDecimal factor, String code, String spec, String pack) { return name == null || name.isBlank() || price == null || factor == null || code == null || code.isBlank() || spec == null || spec.isBlank() || pack == null || pack.isBlank(); }

  public record ProductView(long id, String materialCode, String materialName, String categoryName, String productLine,
      String brandName, String varietyName, String specification, String casePack, BigDecimal bottlePrice, BigDecimal casePrice,
      BigDecimal tonCaseFactor, String customerType, String rebateStatus, boolean giftBox, boolean visible, boolean orderable,
      String dataStatus, int sortNo, int version, List<ImageView> images, List<String> branchScope) {}
  public record ImageView(long id, long fileId, String url, boolean primary, int sortNo) {}
  public record ProductPatch(String customerType, String rebateStatus, String materialCode, String materialName, String categoryName, String productLine, String brandName,
      String varietyName, String specification, String casePack, BigDecimal bottlePrice, boolean bottlePriceSet,
      BigDecimal casePrice, boolean casePriceSet, BigDecimal tonCaseFactor, boolean tonCaseFactorSet,
      Boolean giftBox, Boolean visible, Boolean orderable, String branchScope, String reason) {}
  public record ProductCreate(String customerType, String rebateStatus, String materialCode, String materialName,
      String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack,
      BigDecimal bottlePrice, BigDecimal casePrice, BigDecimal tonCaseFactor, Boolean giftBox, Boolean visible, Boolean orderable,
      String branchScope, String reason) {}
  public record ZipMatch(String filename, String materialName, Long productId, String status) {}
  public record ZipPreview(int imageCount, int matchedCount, int ambiguousCount, int unmatchedCount, List<ZipMatch> matches, boolean committed) {}
  private record ImageCandidates(List<ProductView> products, boolean ambiguous) {}
  private record VersionSource(long versionId, long taskId) {}
}
