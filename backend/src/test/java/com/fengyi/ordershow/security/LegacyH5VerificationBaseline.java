package com.fengyi.ordershow.security;
import com.fengyi.ordershow.common.DomainException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** Frozen verification queries from local HEAD 9b8df44; test-only performance baseline. */
class LegacyH5VerificationBaseline {
  final JdbcTemplate jdbc;
  final CryptoService crypto;
  final AuthService auth;
  LegacyH5VerificationBaseline(JdbcTemplate jdbc, CryptoService crypto, AuthService auth) {
    this.jdbc = jdbc; this.crypto = crypto; this.auth = auth;
  }
  AuthService.H5LoginResult verifyH5(String activityCode, String customerType, String regionCode, String phone,
                                HttpServletRequest request, HttpServletResponse response) {
    String normalized = CryptoService.normalizePhone(phone);
    if (!normalized.matches("1\\d{10}")) throw DomainException.badRequest("INVALID_PHONE", "请输入有效的 11 位手机号");
    String requestedType = customerType == null || customerType.isBlank() ? "ALL" : customerType.trim();
    if (!List.of("GENERAL", "SPECIAL", "ALL").contains(requestedType)) {
      throw DomainException.badRequest("CUSTOMER_TYPE_INVALID", "客户类型不正确");
    }
    // Resolve once in this transaction, never cache identity/publication state across requests.
    var scopes = jdbc.query("""
        SELECT a.id, b.current_version_id,
          EXISTS (SELECT 1 FROM activity_customer c
            WHERE c.activity_id = a.id AND c.data_version_id = b.current_version_id
              AND c.is_active = TRUE AND c.customer_type = 'ALL') unspecified
        FROM activity a
        LEFT JOIN activity_data_binding b ON b.activity_id = a.id AND b.data_type = 'WHITELIST'
        WHERE a.activity_code = ?
        """, (rs, rowNum) -> new WhitelistScope(rs.getLong("id"),
            nullableLong(rs.getObject("current_version_id")), rs.getBoolean("unspecified")), activityCode);
    WhitelistScope scope = scopes.isEmpty() ? null : scopes.getFirst();
    boolean unspecifiedWhitelist = scope != null && scope.unspecified();
    if (unspecifiedWhitelist != "ALL".equals(requestedType)) {
      throw DomainException.notFound("WHITELIST_MODE_MISMATCH", "当前白名单的客户类型模式与本次选择不一致");
    }
    if (scope == null) throw DomainException.notFound("WHITELIST_IDENTITY_NOT_FOUND", "该手机号不在所选通道或大区的有效白名单中");
    String requestedRegion = regionCode == null || regionCode.isBlank() ? null : regionCode.trim();
    // The published path can use every column of the existing phone unique index.
    // A missing binding deliberately retains the legacy all-version lookup/ambiguity check.
    String versionPredicate = scope.versionId() == null
        ? "b.current_version_id IS NULL" : "c.data_version_id = ?";
    var identityArgs = new java.util.ArrayList<Object>();
    identityArgs.add(scope.activityId());
    identityArgs.add(requestedType);
    identityArgs.add(crypto.lookupHash(normalized));
    if (scope.versionId() != null) identityArgs.add(scope.versionId());
    for (int i = 0; i < 6; i++) identityArgs.add(requestedRegion);
    List<H5Principal> customers = jdbc.query("""
        SELECT 0 session_id, c.activity_id, c.id activity_customer_id, a.activity_code,
               c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked
        FROM activity_customer c
        JOIN activity a ON a.id = c.activity_id
        JOIN department d ON d.id = a.department_id AND d.status = 'ACTIVE'
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE c.activity_id = ? AND a.archived_at IS NULL
          AND (a.status = 'CLOSED' OR (a.status IN ('SCHEDULED', 'ACTIVE') AND a.starts_at <= UTC_TIMESTAMP(3)))
          AND (a.event_ends_at IS NULL OR a.event_ends_at > UTC_TIMESTAMP(3))
          AND c.customer_type = ? AND c.phone_lookup_hash = ? AND c.is_active = TRUE
          AND (%s)
          AND (c.customer_type <> 'GENERAL' OR (
            (? IS NULL AND b.current_version_id = c.data_version_id AND NOT EXISTS (
              SELECT 1 FROM activity_customer other_type
              WHERE other_type.activity_id = c.activity_id
                AND other_type.data_version_id = b.current_version_id
                AND other_type.is_active = TRUE AND other_type.customer_type <> 'GENERAL'
            ))
            OR
            NOT EXISTS (
              SELECT 1 FROM activity_customer regionalized
              JOIN activity_data_binding regional_binding
                ON regional_binding.activity_id = regionalized.activity_id
               AND regional_binding.data_type = 'WHITELIST'
               AND regional_binding.current_version_id = regionalized.data_version_id
              WHERE regionalized.activity_id = c.activity_id AND regionalized.customer_type = 'GENERAL'
                AND regionalized.is_active = TRUE AND regionalized.region_code IS NOT NULL
                AND TRIM(regionalized.region_code) <> ''
            )
            OR (? = 'UNASSIGNED' AND (c.region_code IS NULL OR TRIM(c.region_code) = ''))
            OR (? IS NOT NULL AND ? <> '' AND ? <> 'UNASSIGNED' AND c.region_code = ?)
          ))
        """.formatted(versionPredicate), (rs, rowNum) -> new H5Principal(0, rs.getLong("activity_id"), rs.getLong("activity_customer_id"),
        rs.getString("activity_code"), rs.getString("customer_type"), rs.getString("region_code"),
        rs.getString("branch_name"), rs.getString("dealer_short_name"), rs.getString("dealer_full_name"),
        rs.getString("phone_masked")), identityArgs.toArray());
    if (customers.size() != 1) throw DomainException.notFound("WHITELIST_IDENTITY_NOT_FOUND", "该手机号不在所选通道或大区的有效白名单中");
    H5Principal customer = customers.getFirst();
    return auth.createH5Session(customer, request, response);
  }

  private static Long nullableLong(Object value) { return value == null ? null : ((Number)value).longValue(); }
  private record WhitelistScope(long activityId, Long versionId, boolean unspecified) {}
}
