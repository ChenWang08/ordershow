package com.fengyi.ordershow.customer;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AttendanceMatchingService {
  private final JdbcTemplate jdbc;

  public AttendanceMatchingService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Long currentWhitelistVersion(long activityId) {
    return jdbc.query("""
        SELECT current_version_id FROM activity_data_binding
        WHERE activity_id = ? AND data_type = 'WHITELIST'
        """, rs -> rs.next() ? rs.getLong(1) : null, activityId);
  }

  public MatchResult match(long activityId, Long whitelistVersionId, String participantType,
      String branchName, String dealerName) {
    if (whitelistVersionId == null) return MatchResult.unmatched("WHITELIST_NOT_PUBLISHED");
    boolean unspecified = Boolean.TRUE.equals(jdbc.queryForObject("""
        SELECT COUNT(*) > 0 FROM activity_customer
        WHERE activity_id = ? AND data_version_id = ? AND customer_type = 'ALL' AND is_active = TRUE
        """, Boolean.class, activityId, whitelistVersionId));
    String customerType = unspecified ? "ALL" : customerType(participantType);
    if (customerType == null) return MatchResult.unmatched("CUSTOMER_TYPE_UNKNOWN");

    String normalizedDealer = normalize(dealerName);
    List<Long> fullNameMatches = normalizedDealer.isEmpty() ? List.of() : jdbc.queryForList("""
        SELECT id FROM activity_customer
        WHERE activity_id = ? AND data_version_id = ? AND customer_type = ?
          AND normalized_dealer_full_name = ? AND is_active = TRUE
        ORDER BY id
        """, Long.class, activityId, whitelistVersionId, customerType, normalizedDealer);

    String normalizedBranch = normalize(branchName);
    List<Long> shortNameMatches = normalizedDealer.isEmpty() || normalizedBranch.isEmpty() ? List.of() : jdbc.queryForList("""
        SELECT id FROM activity_customer
        WHERE activity_id = ? AND data_version_id = ? AND customer_type = ?
          AND normalized_branch_name = ?
          AND REPLACE(REPLACE(LOWER(dealer_short_name), ' ', ''), '　', '') = ? AND is_active = TRUE
        ORDER BY id
        """, Long.class, activityId, whitelistVersionId, customerType, normalizedBranch, normalizedDealer);

    return decideNameMatches(fullNameMatches, shortNameMatches);
  }

  static MatchResult decideNameMatches(List<Long> fullNameMatches, List<Long> shortNameMatches) {
    Long fullNameCustomer = unique(fullNameMatches);
    Long shortNameCustomer = unique(shortNameMatches);
    if (fullNameCustomer != null && shortNameCustomer != null && !fullNameCustomer.equals(shortNameCustomer)) {
      return MatchResult.pending("FULL_SHORT_NAME_CONFLICT");
    }
    if (fullNameCustomer != null) return MatchResult.matched(fullNameCustomer, "FULL_NAME");
    if (shortNameCustomer != null) return MatchResult.matched(shortNameCustomer, "SHORT_NAME");
    if (fullNameMatches.size() > 1 || shortNameMatches.size() > 1) {
      return MatchResult.pending("MULTIPLE_CANDIDATES");
    }
    return MatchResult.unmatched("NO_UNIQUE_MATCH");
  }

  public void reassociateCurrentAttendance(long activityId, long whitelistVersionId) {
    List<AttendanceInput> rows = jdbc.query("""
        SELECT a.id, a.participant_type, a.branch_name_snapshot, a.dealer_name_snapshot
        FROM activity_attendee a
        JOIN activity_data_binding b ON b.activity_id = a.activity_id AND b.data_type = 'ATTENDANCE'
          AND b.current_version_id = a.data_version_id
        WHERE a.activity_id = ? AND a.is_active = TRUE
        """, this::mapAttendanceInput, activityId);
    for (AttendanceInput row : rows) {
      MatchResult result = match(activityId, whitelistVersionId, row.participantType(), row.branchName(), row.dealerName());
      jdbc.update("""
          UPDATE activity_attendee SET activity_customer_id = ?, match_status = ?, match_method = ?, match_reason_code = ?
          WHERE id = ? AND activity_id = ?
          """, result.customerId(), result.status(), result.method(), result.reasonCode(), row.id(), activityId);
    }
  }

  private AttendanceInput mapAttendanceInput(ResultSet rs, int rowNum) throws SQLException {
    return new AttendanceInput(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4));
  }

  private static Long unique(List<Long> matches) { return matches.size() == 1 ? matches.getFirst() : null; }
  private static String normalize(String value) {
    return value == null ? "" : value.replace("　", "").replaceAll("\\s+", "").toLowerCase();
  }
  private static String customerType(String participantType) {
    if (participantType == null) return null;
    if (participantType.contains("特渠")) return "SPECIAL";
    if (participantType.contains("综合")) return "GENERAL";
    return null;
  }

  public record MatchResult(Long customerId, String status, String method, String reasonCode) {
    static MatchResult matched(long customerId, String method) { return new MatchResult(customerId, "MATCHED", method, null); }
    static MatchResult pending(String reason) { return new MatchResult(null, "PENDING_CONFIRMATION", null, reason); }
    static MatchResult unmatched(String reason) { return new MatchResult(null, "UNMATCHED", null, reason); }
  }
  private record AttendanceInput(long id, String participantType, String branchName, String dealerName) {}
}
