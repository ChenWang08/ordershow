package com.fengyi.ordershow.lottery;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LotteryService {
  private static final Set<String> SCOPES = Set.of("ALL_CUSTOMERS", "ATTENDEES", "VALID_ORDERS");
  private static final Set<String> CUSTOMER_TYPES = Set.of("ALL", "GENERAL", "SPECIAL");
  private static final Set<String> DISPLAY_TYPES = Set.of("SHORT_NAME", "FULL_NAME");

  private final JdbcTemplate jdbc;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final ActivityService activities;
  private final SecureRandom random = new SecureRandom();

  public LotteryService(JdbcTemplate jdbc, StringRedisTemplate redis, ObjectMapper json, ActivityService activities) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.json = json;
    this.activities = activities;
  }

  public List<RuleView> rules(long activityId) {
    return jdbc.query("SELECT id, activity_id, name, status, created_at, updated_at FROM lottery_rule WHERE activity_id = ? ORDER BY id DESC",
        (rs, rowNum) -> new RuleView(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4),
            rs.getTimestamp(5).toInstant(), rs.getTimestamp(6).toInstant(), rounds(rs.getLong(1))), activityId);
  }

  public RuleView rule(long activityId, long ruleId) {
    return rules(activityId).stream().filter(value -> value.id() == ruleId).findFirst()
        .orElseThrow(() -> DomainException.notFound("LOTTERY_RULE_NOT_FOUND", "抽奖规则不存在"));
  }

  @Transactional
  public RuleView create(long activityId, RuleWrite request, AdminPrincipal admin) {
    requireLotteryNotFinished(activityId);
    validate(request);
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      PreparedStatement statement = connection.prepareStatement(
          "INSERT INTO lottery_rule(activity_id, name, status, created_by, updated_by) VALUES (?, ?, 'DRAFT', ?, ?)",
          Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, activityId); statement.setString(2, request.name());
      statement.setLong(3, admin.id()); statement.setLong(4, admin.id());
      return statement;
    }, keys);
    long ruleId = keys.getKey().longValue();
    replaceRounds(activityId, ruleId, request.rounds());
    return rule(activityId, ruleId);
  }

  @Transactional
  public RuleView update(long activityId, long ruleId, RuleWrite request, AdminPrincipal admin) {
    requireLotteryNotFinished(activityId);
    validate(request);
    RuleView current = rule(activityId, ruleId);
    if ("ARCHIVED".equals(current.status())) throw DomainException.conflict("LOTTERY_RULE_READ_ONLY", "已归档规则不能修改");
    jdbc.update("UPDATE lottery_rule SET name = ?, updated_by = ? WHERE id = ? AND activity_id = ?",
        request.name(), admin.id(), ruleId, activityId);
    if ("DRAFT".equals(current.status())) {
      jdbc.update("DELETE FROM lottery_round WHERE lottery_rule_id = ? AND status = 'DRAFT'", ruleId);
      replaceRounds(activityId, ruleId, request.rounds());
    } else {
      revisePublishedRounds(activityId, ruleId, current.rounds(), request.rounds());
      outbox(activityId, "LOTTERY_RULE_REVISED", String.valueOf(ruleId));
    }
    return rule(activityId, ruleId);
  }

  @Transactional
  public RuleView publish(long activityId, long ruleId, AdminPrincipal admin) {
    requireLotteryNotFinished(activityId);
    RuleView current = rule(activityId, ruleId);
    if (!"DRAFT".equals(current.status())) throw DomainException.conflict("LOTTERY_RULE_STATUS", "只有草稿规则可以发布");
    if (current.rounds().isEmpty()) throw DomainException.badRequest("LOTTERY_ROUNDS_EMPTY", "至少配置一个抽奖轮次");
    Integer startedRounds = jdbc.queryForObject("""
        SELECT COUNT(*) FROM lottery_round r JOIN lottery_rule lr ON lr.id = r.lottery_rule_id
        WHERE lr.activity_id = ? AND lr.status = 'PUBLISHED' AND r.status NOT IN ('READY', 'DRAFT')
        """, Integer.class, activityId);
    if (startedRounds != null && startedRounds > 0) {
      throw DomainException.conflict("LOTTERY_RULE_ALREADY_STARTED", "抽奖已开始，请直接修改尚未开始的后续轮次");
    }
    jdbc.update("UPDATE lottery_rule SET status = 'ARCHIVED', updated_by = ? WHERE activity_id = ? AND status = 'PUBLISHED'", admin.id(), activityId);
    jdbc.update("UPDATE lottery_rule SET status = 'PUBLISHED', updated_by = ? WHERE id = ?", admin.id(), ruleId);
    jdbc.update("UPDATE lottery_round SET status = 'READY' WHERE lottery_rule_id = ? AND status = 'DRAFT'", ruleId);
    outbox(activityId, "LOTTERY_RULE_PUBLISHED", String.valueOf(ruleId));
    return rule(activityId, ruleId);
  }

  @Transactional
  public DrawResult draw(long activityId, long roundId, AdminPrincipal admin) {
    requireLotteryWritable(activityId);
    String lockKey = "order-show:lottery:round:" + roundId;
    boolean redisLocked = false;
    try {
      redisLocked = Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, String.valueOf(admin.id()), Duration.ofSeconds(30)));
      if (!redisLocked) throw DomainException.conflict("LOTTERY_DRAW_IN_PROGRESS", "该轮抽奖正在执行，请勿重复点击");
    } catch (DomainException exception) {
      throw exception;
    } catch (Exception ignored) {
      // 数据库行锁仍会保证单次抽取；Redis 不可用不阻断现场抽奖。
    }
    try {
      RoundView round = lockRound(activityId, roundId);
      if (!Set.of("READY", "RESET").contains(round.status())) {
        throw DomainException.conflict("LOTTERY_ROUND_STATUS", "该轮次当前不能抽奖");
      }
      Integer unfinishedPrevious = jdbc.queryForObject("""
          SELECT COUNT(*) FROM lottery_round
          WHERE lottery_rule_id = ? AND round_no < ? AND status <> 'COMPLETED'
          """, Integer.class, round.ruleId(), round.roundNo());
      if (unfinishedPrevious != null && unfinishedPrevious > 0) {
        throw DomainException.conflict("LOTTERY_ROUND_OUT_OF_ORDER", "请先完成前一轮抽奖");
      }
      List<Candidate> candidates = candidates(round);
      if (candidates.isEmpty()) throw DomainException.unprocessable("LOTTERY_CANDIDATES_EMPTY", "当前没有符合条件的候选客户");
      candidates = candidates.stream().map(value -> value.withRandom(randomBytes())).sorted(Comparator.comparing(Candidate::randomKey, LotteryService::compareBytes)).toList();
      int actualWinnerCount = Math.min(round.winnerCount(), candidates.size());
      List<Candidate> winners = candidates.subList(0, actualWinnerCount);
      int attemptNo = round.currentAttemptNo() + 1;
      byte[] resultHash = resultHash(round.id(), attemptNo, candidates, winners);
      long attemptId = insertAttempt(activityId, round, attemptNo, candidates.size(), resultHash, admin);

      List<WinnerView> resultWinners = new ArrayList<>();
      int position = 0;
      for (Candidate candidate : candidates) {
        long snapshotId = insertSnapshot(activityId, round, attemptId, candidate);
        if (position < actualWinnerCount) {
          position++;
          String display = displayName(round, candidate);
          jdbc.update("""
              INSERT INTO lottery_winner(activity_id, round_id, draw_attempt_id, candidate_snapshot_id,
                activity_customer_id, winner_position, dealer_display_name_snapshot)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              """, activityId, round.id(), attemptId, snapshotId, candidate.customerId(), position, display);
          resultWinners.add(new WinnerView(round.id(), position, candidate.customerId(), display, candidate.customerType(),
              candidate.regionCode(), candidate.branchName(), candidate.phoneMasked()));
        }
      }
      jdbc.update("""
          UPDATE lottery_round SET status = 'DRAWN', current_attempt_no = ?, candidate_count = ?, result_hash = ?,
            drawn_at = UTC_TIMESTAMP(3), drawn_by = ?, reset_at = NULL, reset_by = NULL, reset_reason = NULL,
            lock_version = lock_version + 1 WHERE id = ?
          """, attemptNo, candidates.size(), resultHash, admin.id(), round.id());
      outbox(activityId, "LOTTERY_DRAWN", String.valueOf(round.id()));
      return new DrawResult(round.id(), attemptId, attemptNo, candidates.size(), round.winnerCount(), actualWinnerCount,
          round.winnerCount() - actualWinnerCount, resultWinners, HexFormat.of().formatHex(resultHash), Instant.now());
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("LOTTERY_DRAW_CONFLICT", "该轮抽奖已被执行，请刷新查看结果");
    } finally {
      if (redisLocked) {
        try { redis.delete(lockKey); } catch (Exception ignored) { }
      }
    }
  }

  @Transactional
  public RoundView complete(long activityId, long roundId) {
    requireLotteryWritable(activityId);
    RoundView round = lockRound(activityId, roundId);
    if (!"DRAWN".equals(round.status())) throw DomainException.conflict("LOTTERY_ROUND_STATUS", "只有已抽取轮次可以完成");
    jdbc.update("UPDATE lottery_round SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(3), lock_version = lock_version + 1 WHERE id = ?", roundId);
    outbox(activityId, "LOTTERY_ROUND_COMPLETED", String.valueOf(roundId));
    return round(activityId, roundId);
  }

  @Transactional
  public RoundView reset(long activityId, long roundId, String reason, AdminPrincipal admin) {
    requireLotteryWritable(activityId);
    RoundView round = lockRound(activityId, roundId);
    if (!Set.of("DRAWN", "COMPLETED").contains(round.status())) throw DomainException.conflict("LOTTERY_ROUND_STATUS", "当前轮次没有可作废的抽奖结果");
    Integer startedLater = jdbc.queryForObject("""
        SELECT COUNT(*) FROM lottery_round
        WHERE lottery_rule_id = ? AND round_no > ? AND status NOT IN ('READY', 'DRAFT')
        """, Integer.class, round.ruleId(), round.roundNo());
    if (startedLater != null && startedLater > 0) {
      throw DomainException.conflict("LOTTERY_RESET_OUT_OF_ORDER", "后续轮次已经开始，不能单独重置此前轮次");
    }
    if (reason == null || reason.isBlank()) throw DomainException.badRequest("RESET_REASON_REQUIRED", "请填写重抽原因");
    jdbc.update("UPDATE lottery_winner SET status = 'INVALIDATED', invalidated_reason = ?, invalidated_at = UTC_TIMESTAMP(3), invalidated_by = ? WHERE round_id = ? AND status = 'VALID'",
        reason.trim(), admin.id(), roundId);
    jdbc.update("UPDATE lottery_draw_attempt SET status = 'INVALIDATED', invalidated_reason = ?, invalidated_at = UTC_TIMESTAMP(3), invalidated_by = ? WHERE round_id = ? AND status = 'DRAWN'",
        reason.trim(), admin.id(), roundId);
    jdbc.update("UPDATE lottery_round SET status = 'RESET', reset_at = UTC_TIMESTAMP(3), reset_by = ?, reset_reason = ?, lock_version = lock_version + 1 WHERE id = ?",
        admin.id(), reason.trim(), roundId);
    outbox(activityId, "LOTTERY_ROUND_RESET", String.valueOf(roundId));
    return round(activityId, roundId);
  }

  public RoundView round(long activityId, long roundId) {
    return mapRounds("WHERE r.activity_id = ? AND r.id = ?", activityId, roundId).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("LOTTERY_ROUND_NOT_FOUND", "抽奖轮次不存在"));
  }

  public List<WinnerView> publicWinners(long activityId) {
    return jdbc.query("""
        SELECT w.round_id, w.winner_position, w.activity_customer_id, w.dealer_display_name_snapshot, c.customer_type,
          c.region_code, c.branch_name, c.phone_masked
        FROM lottery_winner w JOIN activity_customer c ON c.id = w.activity_customer_id
        WHERE w.activity_id = ? AND w.status = 'VALID' ORDER BY w.created_at DESC, w.winner_position
        """, (rs, rowNum) -> new WinnerView(rs.getLong(1), rs.getInt(2), rs.getLong(3), rs.getString(4), rs.getString(5),
        rs.getString(6), rs.getString(7), rs.getString(8)), activityId);
  }

  public CandidatePreview preview(long activityId, PreviewRequest request) {
    validatePreview(request);
    RoundView virtualRound = new RoundView(0, activityId, 0, request.roundNo(), "预览", null,
        request.winnerCount(), request.candidateScope(), request.customerType(), request.minimumOrderAmount(), null,
        request.roundNo() > 1 && request.excludePreviousWinners(), "FULL_NAME", "DRAFT", 0, null,
        null, null, null, 0);
    List<CandidatePreviewItem> items = candidates(virtualRound).stream().map(candidate -> new CandidatePreviewItem(
        candidate.customerId(), candidate.fullName(), candidate.customerType(), candidate.regionCode(), candidate.branchName(),
        candidate.phoneMasked(), request.candidateScope(), candidate.orderAmount())).toList();
    int actualWinnerCount = Math.min(request.winnerCount(), items.size());
    return new CandidatePreview(Instant.now(), items.size(), request.winnerCount(), actualWinnerCount,
        Math.max(0, request.winnerCount() - actualWinnerCount), items);
  }

  public WinnerStatistics winnerStatistics(long activityId) {
    return jdbc.queryForObject("""
        SELECT SUM(status = 'VALID'), COUNT(DISTINCT CASE WHEN status = 'VALID' THEN activity_customer_id END),
          SUM(status = 'INVALIDATED') FROM lottery_winner WHERE activity_id = ?
        """, (rs, rowNum) -> new WinnerStatistics(rs.getLong(1), rs.getLong(2), rs.getLong(3)), activityId);
  }

  private void requireLotteryWritable(long activityId) {
    String status = activities.byId(activityId).status();
    if ("FINISHED".equals(status) || "ARCHIVED".equals(status)) {
      throw DomainException.conflict("LOTTERY_ACTIVITY_FINISHED", "整场活动已结束，抽奖和重抽均已关闭");
    }
    if (!Set.of("ACTIVE", "CLOSED").contains(status)) {
      throw DomainException.conflict("LOTTERY_ACTIVITY_NOT_STARTED", "活动开始后才可以正式抽奖");
    }
  }

  private void requireLotteryNotFinished(long activityId) {
    String status = activities.byId(activityId).status();
    if ("FINISHED".equals(status) || "ARCHIVED".equals(status)) {
      throw DomainException.conflict("LOTTERY_ACTIVITY_FINISHED", "整场活动已结束，抽奖规则和结果均为只读");
    }
  }

  private List<RoundView> rounds(long ruleId) {
    return mapRounds("WHERE r.lottery_rule_id = ?", ruleId).stream().map(round -> {
      if (round.candidateCount() != null && Set.of("DRAWN", "COMPLETED").contains(round.status())) return round;
      return withCandidateCount(round, candidates(round).size());
    }).toList();
  }

  private RoundView withCandidateCount(RoundView round, int candidateCount) {
    return new RoundView(round.id(), round.activityId(), round.ruleId(), round.roundNo(), round.name(), round.prizeName(),
        round.winnerCount(), round.candidateScope(), round.customerType(), round.minimumOrderAmount(), round.qualificationCutoffAt(),
        round.excludePreviousWinners(), round.displayNameType(), round.status(), round.currentAttemptNo(), candidateCount,
        round.resultHash(), round.drawnAt(), round.completedAt(), round.lockVersion());
  }

  private List<RoundView> mapRounds(String where, Object... args) {
    return jdbc.query("""
        SELECT r.id, r.activity_id, r.lottery_rule_id, r.round_no, r.name, r.prize_name, r.winner_count,
          r.candidate_scope, r.customer_type, r.minimum_order_amount, r.qualification_cutoff_at,
          r.exclude_previous_winners, r.display_name_type, r.status, r.current_attempt_no, r.candidate_count,
          HEX(r.result_hash), r.drawn_at, r.completed_at, r.lock_version
        FROM lottery_round r
        """ + where + " ORDER BY r.round_no", (rs, rowNum) -> new RoundView(rs.getLong(1), rs.getLong(2), rs.getLong(3),
        rs.getInt(4), rs.getString(5), rs.getString(6), rs.getInt(7), rs.getString(8), rs.getString(9),
        rs.getBigDecimal(10), instant(rs.getTimestamp(11)), rs.getBoolean(12), rs.getString(13), rs.getString(14),
        rs.getInt(15), rs.getObject(16) == null ? null : rs.getInt(16), rs.getString(17), instant(rs.getTimestamp(18)), instant(rs.getTimestamp(19)), rs.getInt(20)), args);
  }

  private RoundView lockRound(long activityId, long roundId) {
    List<RoundView> result = jdbc.query("""
        SELECT r.id, r.activity_id, r.lottery_rule_id, r.round_no, r.name, r.prize_name, r.winner_count,
          r.candidate_scope, r.customer_type, r.minimum_order_amount, r.qualification_cutoff_at,
          r.exclude_previous_winners, r.display_name_type, r.status, r.current_attempt_no, r.candidate_count,
          HEX(r.result_hash), r.drawn_at, r.completed_at, r.lock_version
        FROM lottery_round r JOIN lottery_rule lr ON lr.id = r.lottery_rule_id
        WHERE r.activity_id = ? AND r.id = ? AND lr.status = 'PUBLISHED' FOR UPDATE
        """, (rs, rowNum) -> new RoundView(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getInt(4), rs.getString(5),
        rs.getString(6), rs.getInt(7), rs.getString(8), rs.getString(9), rs.getBigDecimal(10), instant(rs.getTimestamp(11)),
        rs.getBoolean(12), rs.getString(13), rs.getString(14), rs.getInt(15), rs.getObject(16) == null ? null : rs.getInt(16), rs.getString(17),
        instant(rs.getTimestamp(18)), instant(rs.getTimestamp(19)), rs.getInt(20)), activityId, roundId);
    if (result.isEmpty()) throw DomainException.notFound("LOTTERY_ROUND_NOT_FOUND", "已发布抽奖轮次不存在");
    return result.getFirst();
  }

  private List<Candidate> candidates(RoundView round) {
    String scopeClause = switch (round.candidateScope()) {
      case "ALL_CUSTOMERS" -> "";
      case "ATTENDEES" -> """
          AND EXISTS (SELECT 1 FROM activity_attendee a
            LEFT JOIN activity_data_binding ab ON ab.activity_id = a.activity_id AND ab.data_type = 'ATTENDANCE'
            WHERE a.activity_id = c.activity_id AND a.activity_customer_id = c.id AND a.is_active = TRUE
              AND a.match_status = 'MATCHED'
              AND (ab.current_version_id IS NULL OR a.data_version_id = ab.current_version_id))
          """;
      case "VALID_ORDERS" -> "AND o.id IS NOT NULL AND o.status = 'SUBMITTED' AND o.total_amount >= ? ";
      default -> throw DomainException.badRequest("LOTTERY_SCOPE_INVALID", "候选范围不正确");
    };
    String previousClause = round.excludePreviousWinners() ? """
        AND NOT EXISTS (SELECT 1 FROM lottery_winner pw WHERE pw.activity_id = c.activity_id
          AND pw.activity_customer_id = c.id AND pw.status = 'VALID')
        """ : "";
    List<Object> args = new ArrayList<>();
    args.add(round.activityId());
    args.add(round.customerType()); args.add(round.customerType());
    if ("VALID_ORDERS".equals(round.candidateScope())) args.add(round.minimumOrderAmount());
    return jdbc.query("""
        SELECT c.id, c.dealer_short_name, c.dealer_full_name, c.customer_type, c.region_code, c.branch_name,
          c.phone_masked, o.id, o.total_amount
        FROM activity_customer c
        JOIN activity_data_binding wb ON wb.activity_id = c.activity_id AND wb.data_type = 'WHITELIST'
          AND wb.current_version_id = c.data_version_id
        LEFT JOIN customer_order o ON o.activity_id = c.activity_id AND o.activity_customer_id = c.id
        WHERE c.activity_id = ? AND c.is_active = TRUE AND (? = 'ALL' OR c.customer_type = ?)
        """ + scopeClause + previousClause + " ORDER BY c.id",
        (rs, rowNum) -> new Candidate(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
            rs.getString(6), rs.getString(7), rs.getObject(8) == null ? null : rs.getLong(8), rs.getBigDecimal(9), null), args.toArray());
  }

  private long insertAttempt(long activityId, RoundView round, int attemptNo, int candidateCount, byte[] resultHash, AdminPrincipal admin) {
    int actualWinnerCount = Math.min(round.winnerCount(), candidateCount);
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    String snapshot = toJson(Map.of("scope", round.candidateScope(), "customerType", round.customerType(),
        "minimumOrderAmount", round.minimumOrderAmount(), "excludePreviousWinners", round.excludePreviousWinners(),
        "configuredWinnerCount", round.winnerCount(), "actualWinnerCount", actualWinnerCount,
        "unawardedCount", round.winnerCount() - actualWinnerCount, "candidateCount", candidateCount,
        "deduplicationKey", "activity_customer.id", "displayNameType", round.displayNameType()));
    jdbc.update(connection -> {
      PreparedStatement statement = connection.prepareStatement("""
          INSERT INTO lottery_draw_attempt(activity_id, round_id, attempt_no, status, candidate_count, winner_count,
            rule_snapshot_json, result_hash, drawn_at, drawn_by)
          VALUES (?, ?, ?, 'DRAWN', ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
          """, Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, activityId); statement.setLong(2, round.id()); statement.setInt(3, attemptNo);
      statement.setInt(4, candidateCount); statement.setInt(5, actualWinnerCount); statement.setString(6, snapshot);
      statement.setBytes(7, resultHash); statement.setLong(8, admin.id());
      return statement;
    }, keys);
    return keys.getKey().longValue();
  }

  private long insertSnapshot(long activityId, RoundView round, long attemptId, Candidate candidate) {
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      PreparedStatement statement = connection.prepareStatement("""
          INSERT INTO lottery_candidate_snapshot(activity_id, round_id, draw_attempt_id, activity_customer_id,
            dealer_short_name_snapshot, dealer_full_name_snapshot, customer_type, region_code, branch_name_snapshot,
            phone_masked_snapshot, qualification_source, qualifying_order_id, qualifying_order_amount, random_sort_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int index = 1;
      statement.setLong(index++, activityId); statement.setLong(index++, round.id()); statement.setLong(index++, attemptId);
      statement.setLong(index++, candidate.customerId()); statement.setString(index++, candidate.shortName());
      statement.setString(index++, candidate.fullName()); statement.setString(index++, candidate.customerType());
      statement.setString(index++, candidate.regionCode()); statement.setString(index++, candidate.branchName());
      statement.setString(index++, candidate.phoneMasked()); statement.setString(index++, round.candidateScope());
      if (candidate.orderId() == null) statement.setNull(index++, java.sql.Types.BIGINT); else statement.setLong(index++, candidate.orderId());
      statement.setBigDecimal(index++, candidate.orderAmount()); statement.setBytes(index, candidate.randomKey());
      return statement;
    }, keys);
    return keys.getKey().longValue();
  }

  private void replaceRounds(long activityId, long ruleId, List<RoundWrite> rounds) {
    int no = 0;
    for (RoundWrite round : rounds) {
      no++;
      insertRound(activityId, ruleId, no, round, "DRAFT");
    }
  }

  private void revisePublishedRounds(long activityId, long ruleId, List<RoundView> current, List<RoundWrite> requested) {
    int lockedThrough = 0;
    for (RoundView round : current) if (!"READY".equals(round.status())) lockedThrough = Math.max(lockedThrough, round.roundNo());
    if (requested.size() < lockedThrough) throw DomainException.conflict("LOTTERY_ROUND_LOCKED", "已开始的轮次不能删除");
    for (int index = 0; index < lockedThrough; index++) {
      RoundView before = current.get(index); RoundWrite after = requested.get(index);
      if (!sameConfiguration(before, after)) {
        throw DomainException.conflict("LOTTERY_ROUND_LOCKED", "第 " + before.roundNo() + " 轮已开始，不能修改");
      }
    }
    for (int index = lockedThrough; index < Math.min(current.size(), requested.size()); index++) {
      RoundView before = current.get(index); RoundWrite after = requested.get(index);
      if (!"READY".equals(before.status())) throw DomainException.conflict("LOTTERY_ROUND_LOCKED", "已开始的轮次不能修改");
      updateReadyRound(before.id(), index + 1, after);
    }
    for (int index = current.size() - 1; index >= requested.size(); index--) {
      RoundView before = current.get(index);
      if (!"READY".equals(before.status())) throw DomainException.conflict("LOTTERY_ROUND_LOCKED", "已开始的轮次不能删除");
      jdbc.update("DELETE FROM lottery_round WHERE id = ? AND status = 'READY'", before.id());
    }
    for (int index = current.size(); index < requested.size(); index++) {
      insertRound(activityId, ruleId, index + 1, requested.get(index), "READY");
    }
  }

  private boolean sameConfiguration(RoundView before, RoundWrite after) {
    return before.name().equals(after.name()) && java.util.Objects.equals(before.prizeName(), after.prizeName())
        && before.winnerCount() == after.winnerCount() && before.candidateScope().equals(after.candidateScope())
        && before.customerType().equals(after.customerType())
        && before.minimumOrderAmount().compareTo(after.minimumOrderAmount()) == 0
        && (before.roundNo() == 1 || before.excludePreviousWinners() == after.excludePreviousWinners());
  }

  private void updateReadyRound(long id, int roundNo, RoundWrite round) {
    jdbc.update("""
        UPDATE lottery_round SET round_no = ?, name = ?, prize_name = ?, winner_count = ?, candidate_scope = ?,
          customer_type = ?, minimum_order_amount = ?, qualification_cutoff_at = NULL,
          exclude_previous_winners = ?, display_name_type = ? WHERE id = ? AND status = 'READY'
        """, roundNo, round.name(), round.prizeName(), round.winnerCount(), round.candidateScope(), round.customerType(),
        round.minimumOrderAmount(), roundNo > 1 && round.excludePreviousWinners(), round.displayNameType(), id);
  }

  private void insertRound(long activityId, long ruleId, int roundNo, RoundWrite round, String status) {
    jdbc.update("""
        INSERT INTO lottery_round(activity_id, lottery_rule_id, round_no, name, prize_name, winner_count,
          candidate_scope, customer_type, minimum_order_amount, qualification_cutoff_at,
          exclude_previous_winners, display_name_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        """, activityId, ruleId, roundNo, round.name(), round.prizeName(), round.winnerCount(), round.candidateScope(),
        round.customerType(), round.minimumOrderAmount(), roundNo > 1 && round.excludePreviousWinners(), round.displayNameType(), status);
  }

  private void validate(RuleWrite request) {
    if (request == null || request.name() == null || request.name().isBlank()) throw DomainException.badRequest("LOTTERY_NAME_REQUIRED", "请填写规则名称");
    if (request.rounds() == null || request.rounds().isEmpty()) throw DomainException.badRequest("LOTTERY_ROUNDS_EMPTY", "至少配置一个抽奖轮次");
    int roundNo = 0;
    for (RoundWrite round : request.rounds()) {
      roundNo++;
      if (round.name() == null || round.name().isBlank() || round.winnerCount() < 1) throw DomainException.badRequest("LOTTERY_ROUND_INVALID", "轮次名称和中奖人数不能为空");
      if (round.prizeName() == null || round.prizeName().isBlank() || "待配置奖品".equals(round.prizeName().trim())) {
        throw DomainException.badRequest("LOTTERY_PRIZE_REQUIRED", "第 " + roundNo + " 轮请填写奖品名称");
      }
      if (!SCOPES.contains(round.candidateScope()) || !CUSTOMER_TYPES.contains(round.customerType()) || !DISPLAY_TYPES.contains(round.displayNameType())) {
        throw DomainException.badRequest("LOTTERY_ROUND_INVALID", "轮次候选范围、客户类型或展示名称配置不正确");
      }
      if (round.minimumOrderAmount() == null || round.minimumOrderAmount().signum() < 0) throw DomainException.badRequest("LOTTERY_AMOUNT_INVALID", "最低订单金额不能小于零");
    }
  }

  private void validatePreview(PreviewRequest request) {
    if (request == null || request.roundNo() < 1 || request.winnerCount() < 1
        || !SCOPES.contains(request.candidateScope()) || !CUSTOMER_TYPES.contains(request.customerType())
        || request.minimumOrderAmount() == null || request.minimumOrderAmount().signum() < 0) {
      throw DomainException.badRequest("LOTTERY_PREVIEW_INVALID", "候选试算条件不正确");
    }
  }

  private String displayName(RoundView round, Candidate candidate) {
    if ("SHORT_NAME".equals(round.displayNameType()) && candidate.shortName() != null && !candidate.shortName().isBlank()) return candidate.shortName();
    return candidate.fullName();
  }

  private void outbox(long activityId, String eventType, String aggregateId) {
    jdbc.update("""
        INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
        VALUES (?, 'LOTTERY', ?, ?, JSON_OBJECT('id', ?), UTC_TIMESTAMP(3))
        """, activityId, aggregateId, eventType, aggregateId);
  }

  private byte[] resultHash(long roundId, int attemptNo, List<Candidate> candidates, List<Candidate> winners) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      digest.update(ByteBuffer.allocate(Long.BYTES + Integer.BYTES).putLong(roundId).putInt(attemptNo).array());
      for (Candidate candidate : candidates) { digest.update(ByteBuffer.allocate(Long.BYTES).putLong(candidate.customerId()).array()); digest.update(candidate.randomKey()); }
      for (Candidate winner : winners) digest.update(ByteBuffer.allocate(Long.BYTES).putLong(winner.customerId()).array());
      return digest.digest();
    } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
  }

  private byte[] randomBytes() { byte[] value = new byte[32]; random.nextBytes(value); return value; }
  private static int compareBytes(byte[] left, byte[] right) {
    for (int index = 0; index < Math.min(left.length, right.length); index++) {
      int compared = Integer.compare(Byte.toUnsignedInt(left[index]), Byte.toUnsignedInt(right[index]));
      if (compared != 0) return compared;
    }
    return Integer.compare(left.length, right.length);
  }
  private String toJson(Object value) { try { return json.writeValueAsString(value); } catch (JsonProcessingException e) { throw new IllegalStateException(e); } }
  private static Instant instant(Timestamp value) { return value == null ? null : value.toInstant(); }

  private record Candidate(long customerId, String shortName, String fullName, String customerType, String regionCode,
                           String branchName, String phoneMasked, Long orderId, BigDecimal orderAmount, byte[] randomKey) {
    Candidate withRandom(byte[] key) { return new Candidate(customerId, shortName, fullName, customerType, regionCode, branchName, phoneMasked, orderId, orderAmount, key); }
  }
  public record RoundWrite(String name, String prizeName, int winnerCount, String candidateScope, String customerType,
                           BigDecimal minimumOrderAmount, Instant qualificationCutoffAt, boolean excludePreviousWinners,
                           String displayNameType) {}
  public record RuleWrite(String name, List<RoundWrite> rounds) {}
  public record RuleView(long id, long activityId, String name, String status, Instant createdAt, Instant updatedAt,
                         List<RoundView> rounds) {}
  public record RoundView(long id, long activityId, long ruleId, int roundNo, String name, String prizeName,
                          int winnerCount, String candidateScope, String customerType, BigDecimal minimumOrderAmount,
                          Instant qualificationCutoffAt, boolean excludePreviousWinners, String displayNameType,
                          String status, int currentAttemptNo, Integer candidateCount, String resultHash,
                          Instant drawnAt, Instant completedAt, int lockVersion) {}
  public record WinnerView(long roundId, int position, long activityCustomerId, String dealerDisplayName, String customerType,
                           String regionCode, String branchName, String phoneMasked) {}
  public record DrawResult(long roundId, long attemptId, int attemptNo, int candidateCount,
                           int configuredWinnerCount, int actualWinnerCount, int unawardedCount,
                           List<WinnerView> winners, String resultHash, Instant drawnAt) {}
  public record PreviewRequest(int roundNo, int winnerCount, String candidateScope, String customerType,
                               BigDecimal minimumOrderAmount, boolean excludePreviousWinners) {}
  public record CandidatePreviewItem(long activityCustomerId, String dealerFullName, String customerType,
                                     String regionCode, String branchName, String phoneMasked,
                                     String qualificationSource, BigDecimal qualifyingOrderAmount) {}
  public record CandidatePreview(Instant calculatedAt, int candidateCount, int configuredWinnerCount,
                                 int actualWinnerCount, int unawardedCount, List<CandidatePreviewItem> candidates) {}
  public record WinnerStatistics(long validWinnerRecords, long validWinnerCustomers, long invalidatedWinnerRecords) {}
}
