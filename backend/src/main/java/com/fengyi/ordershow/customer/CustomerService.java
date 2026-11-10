package com.fengyi.ordershow.customer;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.activity.ActivityRegionService;
import com.fengyi.ordershow.common.TextNormalizer;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.CryptoService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerService {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ActivityService activities;
  private final ActivityRegionService regions;
  private final AttendanceMatchingService attendanceMatching;

  public CustomerService(JdbcTemplate jdbc, CryptoService crypto, ActivityService activities, ActivityRegionService regions,
      AttendanceMatchingService attendanceMatching) {
    this.jdbc = jdbc; this.crypto = crypto; this.activities = activities; this.regions = regions; this.attendanceMatching = attendanceMatching;
  }

  public PageResponse<CustomerView> customers(long activityId, String customerType, String regionCode,
      String keyword, int page, int size, String traceId) {
    int safePage = Math.max(1, page); int safeSize = Math.min(200, Math.max(1, size));
    String normalizedKeyword = keyword == null ? null : keyword.trim();
    String like = normalizedKeyword == null ? null : "%" + normalizedKeyword + "%";
    String normalizedPhone = CryptoService.normalizePhone(normalizedKeyword);
    boolean fullPhoneSearch = normalizedPhone.matches("1\\d{10}");
    byte[] phoneHash = fullPhoneSearch ? crypto.lookupHash(normalizedPhone) : null;
    String phoneMasked = fullPhoneSearch ? CryptoService.maskPhone(normalizedPhone) : null;
    List<Long> legacyPhoneMatches = fullPhoneSearch && indexedPhoneMatchCount(activityId, customerType, regionCode, normalizedPhone, phoneHash, phoneMasked) == 0
        ? legacyPhoneMatches(activityId, customerType, regionCode, normalizedPhone) : List.of();
    String phonePredicate = fullPhoneSearch
        ? " c.phone = ? OR c.phone_lookup_hash = ? OR c.phone_masked = ?" + inPredicate(legacyPhoneMatches.size())
        : " c.phone LIKE ? OR c.phone_masked LIKE ?";
    String where = """
        WHERE c.activity_id = ? AND b.data_type = 'WHITELIST' AND c.data_version_id = b.current_version_id
          AND (? IS NULL OR ? = '' OR c.customer_type = ?)
          AND (? IS NULL OR ? = '' OR c.region_code = ?)
          AND c.is_active = TRUE
          AND (? IS NULL OR ? = '' OR c.dealer_full_name LIKE ? OR c.dealer_short_name LIKE ? OR c.branch_name LIKE ?
            OR """ + phonePredicate + ")\n";
    String phoneLike = normalizedPhone.isEmpty() ? null : "%" + normalizedPhone + "%";
    List<Object> args = new ArrayList<>(Arrays.asList(activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode,
        normalizedKeyword, normalizedKeyword, like, like, like));
    if (fullPhoneSearch) {
      args.add(normalizedPhone);
      args.add(phoneHash);
      args.add(phoneMasked);
      args.addAll(legacyPhoneMatches);
    } else {
      args.add(phoneLike);
      args.add(like);
    }
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM activity_customer c JOIN activity_data_binding b ON b.activity_id = c.activity_id " + where,
        Long.class, args.toArray());
    List<Object> paged = new ArrayList<>(args); paged.add(safeSize); paged.add((safePage - 1) * safeSize);
    List<CustomerView> rows = jdbc.query("""
          SELECT c.id, c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name,
          c.dealer_category, c.contact_name, c.phone, c.phone_ciphertext, c.phone_masked, c.confirmer_name,
          c.confirmer_phone, c.confirmer_phone_ciphertext, c.confirmer_phone_masked,
          c.excel_sequence, c.is_active, c.lock_version, c.updated_at
        FROM activity_customer c JOIN activity_data_binding b ON b.activity_id = c.activity_id
        """ + where + " ORDER BY c.excel_sequence IS NULL, c.excel_sequence, c.id LIMIT ? OFFSET ?", this::mapCustomer, paged.toArray());
    return PageResponse.of(rows, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  private long indexedPhoneMatchCount(long activityId, String customerType, String regionCode, String phone,
                                      byte[] phoneHash, String phoneMasked) {
    Long count = jdbc.queryForObject("""
        SELECT COUNT(*) FROM activity_customer c JOIN activity_data_binding b ON b.activity_id = c.activity_id
        WHERE c.activity_id = ? AND b.data_type = 'WHITELIST' AND c.data_version_id = b.current_version_id
          AND (? IS NULL OR ? = '' OR c.customer_type = ?)
          AND (? IS NULL OR ? = '' OR c.region_code = ?)
          AND c.is_active = TRUE AND (c.phone = ? OR c.phone_lookup_hash = ? OR c.phone_masked = ?)
        """, Long.class, activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode,
        phone, phoneHash, phoneMasked);
    return count == null ? 0 : count;
  }

  private List<Long> legacyPhoneMatches(long activityId, String customerType, String regionCode, String normalizedPhone) {
    List<PhoneCandidate> candidates = jdbc.query("""
        SELECT c.id, c.phone_ciphertext
        FROM activity_customer c JOIN activity_data_binding b ON b.activity_id = c.activity_id
        WHERE c.activity_id = ? AND b.data_type = 'WHITELIST' AND c.data_version_id = b.current_version_id
          AND (? IS NULL OR ? = '' OR c.customer_type = ?)
          AND (? IS NULL OR ? = '' OR c.region_code = ?)
          AND c.is_active = TRUE AND c.phone_ciphertext IS NOT NULL
        """, (rs, rowNum) -> new PhoneCandidate(rs.getLong("id"), rs.getBytes("phone_ciphertext")),
        activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode);
    return candidates.stream().filter(candidate -> samePhone(candidate.ciphertext(), normalizedPhone))
        .map(PhoneCandidate::id).toList();
  }

  private boolean samePhone(byte[] ciphertext, String normalizedPhone) {
    if (ciphertext == null) return false;
    try {
      return normalizedPhone.equals(CryptoService.normalizePhone(crypto.decrypt(ciphertext)));
    } catch (RuntimeException ignored) {
      return false;
    }
  }

  private static String inPredicate(int size) {
    return size == 0 ? "" : " OR c.id IN (" + String.join(", ", java.util.Collections.nCopies(size, "?")) + ")";
  }

  @Transactional
  public CustomerView updateCustomer(long activityId, long customerId, CustomerWrite request) {
    requireCustomerWritable(activityId, request.reason());
    CustomerView current = customer(activityId, customerId);
    boolean replacePhone = request.phone() != null && !request.phone().isBlank() && !request.phone().contains("*");
    String phone = replacePhone ? CryptoService.normalizePhone(request.phone()) : "";
    if (replacePhone && phone.length() != 11) throw DomainException.badRequest("PHONE_INVALID", "手机号必须为 11 位");
    boolean replaceConfirmerPhone = request.confirmerPhone() != null && !request.confirmerPhone().contains("*");
    String confirmerPhone = replaceConfirmerPhone ? CryptoService.normalizePhone(request.confirmerPhone()) : "";
    if (replaceConfirmerPhone && !confirmerPhone.isEmpty() && confirmerPhone.length() != 11) {
      throw DomainException.badRequest("CONFIRMER_PHONE_INVALID", "分公司确认人手机号必须为 11 位");
    }
    String regionCode = regions.resolveCode(activityId, request.regionCode());
    try {
      int changed = jdbc.update("""
          UPDATE activity_customer SET region_code = ?, branch_name = ?, normalized_branch_name = ?, dealer_short_name = ?,
            dealer_full_name = ?, normalized_dealer_full_name = ?, dealer_category = ?, contact_name = ?,
            phone = IF(?, ?, phone), phone_lookup_hash = IF(?, ?, phone_lookup_hash),
            phone_masked = IF(?, ?, phone_masked), confirmer_name = ?,
            confirmer_phone = IF(?, ?, confirmer_phone),
            confirmer_phone_masked = IF(?, ?, confirmer_phone_masked), lock_version = lock_version + 1
          WHERE id = ? AND activity_id = ? AND lock_version = ?
          """, regionCode, blankToNull(request.branchName()), normalize(request.branchName()),
          blankToNull(request.dealerShortName()), required(request.dealerFullName(), "经销商名称不能为空"), normalize(required(request.dealerFullName(), "经销商名称不能为空")),
          blankToNull(request.dealerCategory()), blankToNull(request.contactName()), replacePhone, replacePhone ? phone : null,
          replacePhone, replacePhone ? crypto.lookupHash(phone) : null, replacePhone, replacePhone ? CryptoService.maskPhone(phone) : null,
          blankToNull(request.confirmerName()), replaceConfirmerPhone,
          confirmerPhone.isEmpty() ? null : confirmerPhone, replaceConfirmerPhone,
          confirmerPhone.isEmpty() ? null : CryptoService.maskPhone(confirmerPhone), customerId, activityId, request.expectedVersion());
      if (changed != 1) throw DomainException.conflict("CUSTOMER_VERSION_CONFLICT", "客户信息已变化，请刷新后重试");
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("CUSTOMER_PHONE_EXISTS", "该渠道下手机号已对应其他客户");
    }
    reassociateAttendance(activityId);
    if (!java.util.Objects.equals(normalize(current.branchName()), normalize(request.branchName()))
        || !java.util.Objects.equals(normalize(current.dealerFullName()), normalize(request.dealerFullName()))) {
      com.fengyi.ordershow.catalog.ProductCatalogChanges.all(jdbc, activityId);
    }
    if (!java.util.Objects.equals(current.regionCode(), regionCode)) {
      com.fengyi.ordershow.activity.ActivityInfoChanges.record(jdbc, activityId);
    }
    return customer(activityId, customerId);
  }

  @Transactional
  public CustomerView addCustomer(long activityId, CustomerWrite request) {
    requireCustomerWritable(activityId, request.reason());
    String customerType = required(request.customerType(), "客户类型不能为空");
    if (!List.of("GENERAL", "SPECIAL", "ALL").contains(customerType)) throw DomainException.badRequest("CUSTOMER_TYPE_INVALID", "客户类型不正确");
    String fullName = required(request.dealerFullName(), "经销商名称不能为空");
    String phone = CryptoService.normalizePhone(request.phone());
    if (phone.length() != 11) throw DomainException.badRequest("PHONE_INVALID", "手机号必须为 11 位");
    String confirmerPhone = CryptoService.normalizePhone(request.confirmerPhone());
    if (!confirmerPhone.isEmpty() && confirmerPhone.length() != 11) {
      throw DomainException.badRequest("CONFIRMER_PHONE_INVALID", "分公司确认人手机号必须为 11 位");
    }
    String regionCode = regions.resolveCode(activityId, request.regionCode());
    VersionSource source = currentSource(activityId, "WHITELIST");
    try {
      String branchName = request.branchName() == null ? "" : request.branchName().trim();
      String normalizedBranch = normalize(branchName);
      jdbc.update("""
          INSERT INTO customer(customer_type, dealer_full_name, normalized_dealer_full_name, branch_name, normalized_branch_name) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE dealer_full_name = VALUES(dealer_full_name), branch_name = VALUES(branch_name),
            normalized_branch_name = VALUES(normalized_branch_name), updated_at = UTC_TIMESTAMP(3)
          """, customerType, fullName, normalize(fullName), branchName, normalizedBranch);
      Long customerId = jdbc.queryForObject("SELECT id FROM customer WHERE customer_type = ? AND normalized_dealer_full_name = ? AND normalized_branch_name = ?",
          Long.class, customerType, normalize(fullName), normalizedBranch);
      jdbc.update("""
          INSERT INTO activity_customer(activity_id, customer_id, customer_type, region_code, branch_name, normalized_branch_name,
            dealer_short_name, dealer_full_name, normalized_dealer_full_name, dealer_category, contact_name, phone, phone_lookup_hash, phone_masked,
            confirmer_name, confirmer_phone, confirmer_phone_masked, excel_sequence, is_active, source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(c.excel_sequence), 0) + 1 FROM activity_customer c WHERE c.activity_id = ? AND c.data_version_id = ?),
            TRUE, ?, ?)
          """, activityId, customerId, customerType, regionCode, blankToNull(request.branchName()),
          normalizedBranch, blankToNull(request.dealerShortName()), fullName, normalize(fullName), blankToNull(request.dealerCategory()),
          blankToNull(request.contactName()), phone, crypto.lookupHash(phone), CryptoService.maskPhone(phone),
          blankToNull(request.confirmerName()), confirmerPhone.isEmpty() ? null : confirmerPhone,
          confirmerPhone.isEmpty() ? null : CryptoService.maskPhone(confirmerPhone),
          activityId, source.versionId(), source.taskId(), source.versionId());
      Long id = jdbc.queryForObject("SELECT id FROM activity_customer WHERE activity_id = ? AND data_version_id = ? AND customer_id = ?",
          Long.class, activityId, source.versionId(), customerId);
      reassociateAttendance(activityId);
      com.fengyi.ordershow.activity.ActivityInfoChanges.record(jdbc, activityId);
      com.fengyi.ordershow.catalog.ProductCatalogChanges.all(jdbc, activityId);
      return customer(activityId, id);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("CUSTOMER_EXISTS", "当前白名单已存在同名客户或该渠道下手机号已被使用");
    }
  }

  @Transactional
  public void deleteCustomer(long activityId, long customerId, int expectedVersion) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    String status = activities.byId(activityId).status();
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(status)) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后数据只读");
    if ("SCHEDULED".equals(status)) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后白名单已锁定，请先撤回发布");
    if ("ACTIVE".equals(status)) throw DomainException.conflict("ACTIVITY_IMPORT_LOCKED", "活动开始后不能删除白名单客户");
    int changed = jdbc.update("""
        UPDATE activity_customer SET is_active = FALSE, deactivated_at = UTC_TIMESTAMP(3), lock_version = lock_version + 1
        WHERE id = ? AND activity_id = ? AND is_active = TRUE AND lock_version = ?
        """, customerId, activityId, expectedVersion);
    if (changed != 1) throw DomainException.conflict("CUSTOMER_VERSION_CONFLICT", "客户已被删除或发生变化，请刷新后重试");
    jdbc.update("UPDATE h5_session SET revoked_at = UTC_TIMESTAMP(3) WHERE activity_customer_id = ? AND revoked_at IS NULL", customerId);
    reassociateAttendance(activityId);
    com.fengyi.ordershow.activity.ActivityInfoChanges.record(jdbc, activityId);
    com.fengyi.ordershow.catalog.ProductCatalogChanges.all(jdbc, activityId);
  }

  public PageResponse<AttendeeView> attendees(long activityId, String matchStatus, String keyword, int page, int size, String traceId) {
    int safePage = Math.max(1, page); int safeSize = Math.min(200, Math.max(1, size));
    String where = """
        WHERE a.activity_id = ? AND a.is_active = TRUE
          AND ((b.current_version_id IS NULL AND a.data_version_id IS NULL) OR a.data_version_id = b.current_version_id)
          AND (? IS NULL OR ? = '' OR a.match_status = ?)
          AND (? IS NULL OR ? = '' OR a.participant_name LIKE ? OR a.dealer_name_snapshot LIKE ? OR a.phone_masked LIKE ?)
        """;
    String like = keyword == null ? null : "%" + keyword.trim() + "%";
    Object[] args = {activityId, matchStatus, matchStatus, matchStatus, keyword, keyword, like, like, like};
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM activity_attendee a LEFT JOIN activity_data_binding b ON b.activity_id = a.activity_id AND b.data_type = 'ATTENDANCE' " + where,
        Long.class, args);
    List<Object> paged = new ArrayList<>(Arrays.asList(args)); paged.add(safeSize); paged.add((safePage - 1) * safeSize);
    List<AttendeeView> rows = jdbc.query("""
        SELECT a.id, a.activity_customer_id, a.participant_name, a.gender, a.participant_type, a.dealer_name_snapshot,
          a.branch_name_snapshot, a.phone, a.phone_masked, a.match_status, a.match_method, a.match_reason_code,
          COALESCE(c.dealer_short_name, c.dealer_full_name),
          (a.match_status = 'MATCHED' AND c.is_active = TRUE AND wb.current_version_id IS NOT NULL),
          a.created_at, a.updated_at
        FROM activity_attendee a LEFT JOIN activity_data_binding b ON b.activity_id = a.activity_id AND b.data_type = 'ATTENDANCE'
        LEFT JOIN activity_customer c ON c.id = a.activity_customer_id AND c.activity_id = a.activity_id
        LEFT JOIN activity_data_binding wb ON wb.activity_id = c.activity_id AND wb.data_type = 'WHITELIST' AND wb.current_version_id = c.data_version_id
        """ + where + " ORDER BY a.id DESC LIMIT ? OFFSET ?", this::mapAttendee, paged.toArray());
    return PageResponse.of(rows, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  @Transactional
  public AttendeeView addAttendee(long activityId, AttendeeWrite request, AdminPrincipal admin) {
    requireAttendanceWritable(activityId);
    String phone = CryptoService.normalizePhone(request.phone());
    AttendanceMatchingService.MatchResult match = attendanceMatching.match(activityId,
        attendanceMatching.currentWhitelistVersion(activityId), request.participantType(), request.branchName(), request.dealerName());
    Long versionId = currentVersion(activityId, "ATTENDANCE");
    jdbc.update("""
        INSERT INTO activity_attendee(activity_id, activity_customer_id, match_status, match_method, match_reason_code,
          participant_name, gender, participant_type,
          dealer_name_snapshot, branch_name_snapshot, phone, phone_lookup_hash, phone_masked,
          data_version_id, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
        """, activityId, match.customerId(), match.status(), match.method(), match.reasonCode(),
        blankToNull(request.participantName()), blankToNull(request.gender()),
        blankToNull(request.participantType()), required(request.dealerName(), "经销商名称不能为空"),
        blankToNull(request.branchName()), phone.isEmpty() ? null : phone, phone.isEmpty() ? null : crypto.lookupHash(phone),
        phone.isEmpty() ? null : CryptoService.maskPhone(phone), versionId, admin.id());
    Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    return attendee(activityId, id);
  }

  @Transactional
  public AttendeeView updateAttendee(long activityId, long attendeeId, AttendeeWrite request) {
    requireAttendanceWritable(activityId);
    boolean replacePhone = request.phone() != null && !request.phone().isBlank() && !request.phone().contains("*");
    String currentPhone = jdbc.query("SELECT phone FROM activity_attendee WHERE id = ? AND activity_id = ? AND is_active = TRUE",
        rs -> rs.next() ? rs.getString(1) : null, attendeeId, activityId);
    String phone = replacePhone ? CryptoService.normalizePhone(request.phone()) : currentPhone == null ? "" : currentPhone;
    AttendanceMatchingService.MatchResult match = attendanceMatching.match(activityId,
        attendanceMatching.currentWhitelistVersion(activityId), request.participantType(), request.branchName(), request.dealerName());
    int changed = jdbc.update("""
        UPDATE activity_attendee SET activity_customer_id = ?, match_status = ?, match_method = ?, match_reason_code = ?,
          participant_name = ?, gender = ?, participant_type = ?,
          dealer_name_snapshot = ?, branch_name_snapshot = ?, phone = IF(?, ?, phone),
          phone_lookup_hash = IF(?, ?, phone_lookup_hash), phone_masked = IF(?, ?, phone_masked)
        WHERE id = ? AND activity_id = ? AND is_active = TRUE
        """, match.customerId(), match.status(), match.method(), match.reasonCode(),
        blankToNull(request.participantName()), blankToNull(request.gender()), blankToNull(request.participantType()),
        required(request.dealerName(), "经销商名称不能为空"), blankToNull(request.branchName()),
        replacePhone, replacePhone ? phone : null, replacePhone, replacePhone ? crypto.lookupHash(phone) : null,
        replacePhone, replacePhone ? CryptoService.maskPhone(phone) : null, attendeeId, activityId);
    if (changed != 1) throw DomainException.notFound("ATTENDEE_NOT_FOUND", "到场记录不存在");
    return attendee(activityId, attendeeId);
  }

  @Transactional
  public void deleteAttendee(long activityId, long attendeeId) {
    requireAttendanceWritable(activityId);
    int changed = jdbc.update("UPDATE activity_attendee SET is_active = FALSE WHERE id = ? AND activity_id = ? AND is_active = TRUE", attendeeId, activityId);
    if (changed != 1) throw DomainException.notFound("ATTENDEE_NOT_FOUND", "到场记录不存在");
  }

  private CustomerView customer(long activityId, long id) {
    return jdbc.query("""
        SELECT id, customer_type, region_code, branch_name, dealer_short_name, dealer_full_name, dealer_category,
          contact_name, phone, phone_ciphertext, phone_masked, confirmer_name, confirmer_phone,
          confirmer_phone_ciphertext, confirmer_phone_masked,
          excel_sequence, is_active, lock_version, updated_at
        FROM activity_customer WHERE activity_id = ? AND id = ?
        """, this::mapCustomer, activityId, id).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("CUSTOMER_NOT_FOUND", "客户不存在"));
  }

  private AttendeeView attendee(long activityId, long id) {
    return jdbc.query("""
        SELECT id, activity_customer_id, participant_name, gender, participant_type, dealer_name_snapshot,
          branch_name_snapshot, phone, phone_masked, match_status, match_method, match_reason_code,
          (SELECT COALESCE(c.dealer_short_name, c.dealer_full_name) FROM activity_customer c WHERE c.id = activity_customer_id),
          (match_status = 'MATCHED' AND EXISTS (SELECT 1 FROM activity_customer c
            JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST' AND b.current_version_id = c.data_version_id
            WHERE c.id = activity_customer_id AND c.is_active = TRUE)),
          created_at, updated_at FROM activity_attendee WHERE activity_id = ? AND id = ?
        """, this::mapAttendee, activityId, id).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("ATTENDEE_NOT_FOUND", "到场记录不存在"));
  }

  private Long currentVersion(long activityId, String type) {
    List<Long> values = jdbc.query("SELECT current_version_id FROM activity_data_binding WHERE activity_id = ? AND data_type = ?",
        (rs, rowNum) -> rs.getObject(1) == null ? null : rs.getLong(1), activityId, type);
    return values.isEmpty() ? null : values.getFirst();
  }

  private VersionSource currentSource(long activityId, String type) {
    return jdbc.query("""
        SELECT v.id, v.source_import_task_id FROM activity_data_binding b
        JOIN import_publish_version v ON v.id = b.current_version_id
        WHERE b.activity_id = ? AND b.data_type = ?
        """, (rs, rowNum) -> new VersionSource(rs.getLong(1), rs.getLong(2)), activityId, type).stream().findFirst()
        .orElseThrow(() -> DomainException.conflict("DATA_VERSION_REQUIRED", "请先发布一次名单 Excel，再手动维护数据"));
  }

  private void requireCustomerWritable(long activityId, String reason) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    String status = activities.byId(activityId).status();
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(status)) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后数据只读");
    if ("SCHEDULED".equals(status)) throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后白名单已锁定，请先撤回发布");
    if ("ACTIVE".equals(status) && (reason == null || reason.isBlank())) {
      throw DomainException.badRequest("CUSTOMER_EDIT_REASON_REQUIRED", "活动开始后修改白名单必须填写原因");
    }
  }

  private void requireAttendanceWritable(long activityId) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", activityId);
    if (List.of("CLOSED", "FINISHED", "ARCHIVED").contains(activities.byId(activityId).status())) throw DomainException.conflict("ACTIVITY_READ_ONLY", "订货截止后到场名单只读");
  }

  CustomerView mapCustomer(ResultSet rs, int rowNum) throws SQLException {
    String phone = rs.getString(9) == null ? decrypt(rs.getBytes(10)) : rs.getString(9);
    String confirmerPhone = rs.getString(13) == null ? decrypt(rs.getBytes(14)) : rs.getString(13);
    return new CustomerView(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
        rs.getString(6), rs.getString(7), rs.getString(8), phone, rs.getString(11), rs.getString(12),
        confirmerPhone, rs.getString(15), rs.getObject(16) == null ? null : rs.getInt(16), rs.getBoolean(17),
        rs.getInt(18), UtcTime.read(rs, 19));
  }
  AttendeeView mapAttendee(ResultSet rs, int rowNum) throws SQLException {
    return new AttendeeView(rs.getLong(1), rs.getObject(2) == null ? null : rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5),
        rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), rs.getString(11), rs.getString(12),
        rs.getString(13), rs.getBoolean(14), UtcTime.read(rs, 15), UtcTime.read(rs, 16));
  }
  private String decrypt(byte[] value) { return value == null ? null : crypto.decrypt(value); }
  private static String normalize(String value) { return value == null ? null : TextNormalizer.normalize(value); }
  private static String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
  private static String required(String value, String message) { if (value == null || value.isBlank()) throw DomainException.badRequest("FIELD_REQUIRED", message); return value.trim(); }

  public record CustomerView(long id, String customerType, String regionCode, String branchName, String dealerShortName,
      String dealerFullName, String dealerCategory, String contactName, String phone, String phoneMasked, String confirmerName,
      String confirmerPhone, String confirmerPhoneMasked, Integer excelSequence, boolean active, int lockVersion, java.time.Instant updatedAt) {}
  public record CustomerWrite(String customerType, String regionCode, String branchName, String dealerShortName, String dealerFullName,
      String dealerCategory, String contactName, String phone, String confirmerName, String confirmerPhone, int expectedVersion, String reason) {}
  public record AttendeeView(long id, Long activityCustomerId, String participantName, String gender, String participantType,
      String dealerName, String branchName, String phone, String phoneMasked, String matchStatus, String matchMethod,
      String matchReasonCode, String matchedDealerName, boolean lotteryEligible, java.time.Instant createdAt, java.time.Instant updatedAt) {}
  public record AttendeeWrite(String participantName, String gender, String participantType, String dealerName,
      String branchName, String phone) {}
  private record VersionSource(long versionId, long taskId) {}
  private record PhoneCandidate(long id, byte[] ciphertext) {}

  void reassociateAttendance(long activityId) {
    Long whitelistVersion = attendanceMatching.currentWhitelistVersion(activityId);
    if (whitelistVersion != null) attendanceMatching.reassociateCurrentAttendance(activityId, whitelistVersion);
  }
}
