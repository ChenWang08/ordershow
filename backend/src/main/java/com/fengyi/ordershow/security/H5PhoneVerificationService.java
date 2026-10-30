package com.fengyi.ordershow.security;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TraceFilter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Phone-first entry: region is identity data, never a user-selected login constraint. */
@Service
public class H5PhoneVerificationService {
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(H5PhoneVerificationService.class);
  private final JdbcTemplate jdbc;
  private final AuthService auth;
  private final CryptoService crypto;
  private final TransactionTemplate transaction;
  private final MeterRegistry meters;

  public H5PhoneVerificationService(JdbcTemplate jdbc, AuthService auth, CryptoService crypto,
      PlatformTransactionManager manager, MeterRegistry meters) {
    this.jdbc = jdbc;
    this.auth = auth;
    this.crypto = crypto;
    this.transaction = new TransactionTemplate(manager);
    this.meters = meters;
  }

  public VerificationResult verify(String activityCode, String customerType, String phone,
      HttpServletRequest request, HttpServletResponse response) {
    // Neither an authenticated response nor the list of possible identities may be cached by proxies.
    response.setHeader("Cache-Control", "no-store");
    long started = System.nanoTime();
    long[] stages = new long[4];
    String outcome = "error";
    try {
      String normalized = CryptoService.normalizePhone(phone);
      if (!normalized.matches("1\\d{10}")) throw DomainException.badRequest("INVALID_PHONE", "请输入有效的 11 位手机号");
      String type = customerType == null || customerType.isBlank() ? null : customerType.trim();
      if (type != null && !List.of("GENERAL", "SPECIAL", "ALL").contains(type)) {
        throw DomainException.badRequest("CUSTOMER_TYPE_INVALID", "客户类型不正确");
      }
      byte[] hash = crypto.lookupHash(normalized);
      long begin = System.nanoTime();
      long[] bodyFinished = {0};
      boolean[] entered = {false};
      VerificationResult result;
      try {
        result = transaction.execute(status -> {
          entered[0] = true;
          stages[0] = record("transaction_begin", begin); // Includes acquisition and transaction setup.
          try {
            var candidates = timed("identity_query", () -> identities(activityCode, type, hash), stages, 1);
            if (candidates.isEmpty()) throw DomainException.notFound("WHITELIST_IDENTITY_NOT_FOUND", "该手机号不在当前活动的有效白名单中");
            var types = candidates.stream().map(H5Principal::customerType).distinct().sorted().toList();
            // Same-type duplicates and ALL mixed with another identity are not silently guessed.
            if (types.size() != candidates.size() || (types.size() > 1 && types.contains("ALL"))) {
              throw DomainException.conflict("WHITELIST_IDENTITY_AMBIGUOUS", "该手机号的白名单身份存在冲突，请联系工作人员确认");
            }
            if (candidates.size() > 1) return new VerificationResult(null, null, true, types);
            var login = timed("session_create", () -> auth.createH5Session(candidates.getFirst(), request, response), stages, 2);
            return new VerificationResult(login.customer(), login.csrfToken(), false, null);
          } finally { bodyFinished[0] = System.nanoTime(); }
        });
      } finally {
        if (!entered[0]) stages[0] = record("transaction_begin", begin);
        // Commit/rollback and synchronizations; not mislabeled as pure database commit time.
        if (bodyFinished[0] != 0) stages[3] = record("transaction_finish", bodyFinished[0]);
      }
      outcome = result.selectionRequired() ? "selection" : "login";
      return result;
    } catch (DomainException exception) {
      outcome = "rejected";
      throw exception;
    } finally {
      meters.timer("order_show.h5.verify.total", "outcome", outcome)
          .record(System.nanoTime() - started, TimeUnit.NANOSECONDS);
      long elapsed = System.nanoTime() - started;
      if (elapsed >= TimeUnit.MILLISECONDS.toNanos(500)) {
        LOG.info("h5.verify.slow trace={} outcome={} total_ms={} transaction_begin_ms={} identity_query_ms={} session_create_ms={} transaction_finish_ms={}",
            TraceFilter.id(request), outcome, elapsed / 1_000_000, stages[0] / 1_000_000, stages[1] / 1_000_000,
            stages[2] / 1_000_000, stages[3] / 1_000_000);
      }
    }
  }

  private List<H5Principal> identities(String code, String type, byte[] hash) {
    // A missing/null publication binding retains the legacy lookup across versions. Multiple
    // same-type matches still fail closed. Published activities only read their current version.
    // LIMIT 4 bounds malformed legacy results: there are only three supported customer types.
    String sql = """
        SELECT c.id, c.activity_id, a.activity_code, c.customer_type, c.region_code,
               c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked
        FROM activity a
        JOIN department d ON d.id = a.department_id AND d.status = 'ACTIVE'
        LEFT JOIN activity_data_binding b ON b.activity_id = a.id AND b.data_type = 'WHITELIST'
        JOIN activity_customer c ON c.activity_id = a.id
        WHERE a.activity_code = ? AND a.archived_at IS NULL
          AND (a.status = 'CLOSED' OR (a.status IN ('SCHEDULED','ACTIVE') AND a.starts_at <= UTC_TIMESTAMP(3)))
          AND (a.event_ends_at IS NULL OR a.event_ends_at > UTC_TIMESTAMP(3))
          AND c.is_active = TRUE AND c.phone_lookup_hash = ?
          AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
        """ + (type == null ? "" : " AND c.customer_type = ?") + " ORDER BY c.customer_type, c.id LIMIT 4";
    Object[] args = type == null ? new Object[]{code, hash} : new Object[]{code, hash, type};
    return jdbc.query(sql, (rs, row) -> new H5Principal(0, rs.getLong("activity_id"), rs.getLong("id"),
        rs.getString("activity_code"), rs.getString("customer_type"), rs.getString("region_code"),
        rs.getString("branch_name"), rs.getString("dealer_short_name"), rs.getString("dealer_full_name"),
        rs.getString("phone_masked")), args);
  }

  private <T> T timed(String stage, Supplier<T> action, long[] stages, int index) {
    long start = System.nanoTime();
    try { return action.get(); } finally { stages[index] = record(stage, start); }
  }

  private long record(String stage, long start) {
    long elapsed = System.nanoTime() - start;
    meters.timer("order_show.h5.verify.stage", "stage", stage).record(elapsed, TimeUnit.NANOSECONDS);
    return elapsed;
  }

  public record VerificationResult(H5Principal customer, String csrfToken, boolean selectionRequired,
                                   List<String> customerTypes) {}
}
