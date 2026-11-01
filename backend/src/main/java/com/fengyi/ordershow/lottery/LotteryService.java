package com.fengyi.ordershow.lottery;

import com.fengyi.ordershow.common.UtcTime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.storage.StorageService;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import org.springframework.beans.factory.annotation.Value;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class LotteryService {
  private static final Set<String> SCOPES = Set.of("ALL_CUSTOMERS", "ATTENDEES", "VALID_ORDERS");
  private static final Set<String> CUSTOMER_TYPES = Set.of("ALL", "GENERAL", "SPECIAL");
  private static final Set<String> QUALIFICATION_METRICS = Set.of("AMOUNT", "BOX_COUNT", "TONS");
  private static final Set<String> PROBABILITY_MODES = Set.of("EQUAL", "ORDER_AMOUNT_WEIGHTED", "ORDER_BOX_COUNT_WEIGHTED", "ORDER_TONS_WEIGHTED");
  private static final Set<String> DISPLAY_TYPES = Set.of("SHORT_NAME", "FULL_NAME");
  private static final Set<String> PRIZE_IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "webp", "gif", "bmp");
  private static final long MAX_PRIZE_IMAGE_SIZE = 10L * 1024 * 1024;

  private final JdbcTemplate jdbc;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final ActivityService activities;
  private final StorageService storage;
  private final SecureRandom random = new SecureRandom();
  @Value("${LOTTERY_QUERY_TIMEOUT_SECONDS:8}")
  private int queryTimeoutSeconds = 8;

  public LotteryService(JdbcTemplate jdbc, StringRedisTemplate redis, ObjectMapper json, ActivityService activities,
                        StorageService storage) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.json = json;
    this.activities = activities;
    this.storage = storage;
  }

  public PrizeImageView uploadPrizeImage(long activityId, MultipartFile file, AdminPrincipal admin) {
    requireLotteryNotFinished(activityId);
    if (file == null || file.isEmpty()) throw DomainException.badRequest("LOTTERY_PRIZE_IMAGE_REQUIRED", "请选择奖品图片");
    String filename = file.getOriginalFilename();
    int extensionStart = filename == null ? -1 : filename.lastIndexOf('.');
    String extension = extensionStart < 0 ? "" : filename.substring(extensionStart + 1).toLowerCase(Locale.ROOT);
    if (!PRIZE_IMAGE_EXTENSIONS.contains(extension)) {
      throw DomainException.badRequest("LOTTERY_PRIZE_IMAGE_TYPE_INVALID", "仅支持 JPG、PNG、WEBP、GIF、BMP 图片");
    }
    if (file.getSize() > MAX_PRIZE_IMAGE_SIZE) {
      throw DomainException.badRequest("LOTTERY_PRIZE_IMAGE_TOO_LARGE", "奖品图片不能超过 10MB");
    }
    StorageService.StoredFile stored = storage.save(activityId, file, "LOTTERY_PRIZE_IMAGE", admin.id());
    return new PrizeImageView(stored.id(), prizeImageUrl(stored.id()), stored.originalFilename(), stored.contentType(), stored.sizeBytes());
  }

  @Transactional
  public boolean deleteUnattachedPrizeImage(long activityId, long fileId) {
    requireLotteryNotFinished(activityId);
    List<Long> files = jdbc.queryForList("""
        SELECT id FROM stored_file
        WHERE id = ? AND activity_id = ? AND file_purpose = 'LOTTERY_PRIZE_IMAGE' AND deleted_at IS NULL
        FOR UPDATE
        """, Long.class, fileId, activityId);
    if (files.size() != 1) throw DomainException.notFound("LOTTERY_PRIZE_IMAGE_NOT_FOUND", "奖品图片不存在或已移除");
    Integer references = jdbc.queryForObject("SELECT COUNT(*) FROM lottery_round WHERE prize_image_file_id = ?",
        Integer.class, fileId);
    if (references != null && references > 0) {
      throw DomainException.conflict("LOTTERY_PRIZE_IMAGE_IN_USE", "该奖品图片已关联抽奖轮次");
    }
    jdbc.update("""
        UPDATE stored_file SET deleted_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND activity_id = ? AND file_purpose = 'LOTTERY_PRIZE_IMAGE' AND deleted_at IS NULL
        """, fileId, activityId);
    return true;
  }

  private void validatePrizeImageReference(long activityId, Long fileId) {
    if (fileId == null) return;
    List<Long> available = jdbc.queryForList("""
        SELECT id FROM stored_file
        WHERE id = ? AND activity_id = ? AND file_purpose = 'LOTTERY_PRIZE_IMAGE' AND deleted_at IS NULL
        FOR UPDATE
        """, Long.class, fileId, activityId);
    if (available.size() != 1) {
      throw DomainException.badRequest("LOTTERY_PRIZE_IMAGE_INVALID", "奖品图片无效或不属于当前活动");
    }
  }

  private void cleanupUnreferencedPrizeImages(long activityId, List<Long> fileIds) {
    for (Long fileId : fileIds) {
      if (fileId == null) continue;
      jdbc.update("""
          UPDATE stored_file SET deleted_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND activity_id = ? AND file_purpose = 'LOTTERY_PRIZE_IMAGE' AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM lottery_round WHERE prize_image_file_id = ?)
          """, fileId, activityId, fileId);
    }
  }

  private static String prizeImageUrl(Long fileId) {
    return fileId == null ? null : "/api/v1/public/files/" + fileId;
  }

  public List<RuleView> rules(long activityId) {
    return readRules("WHERE activity_id = ?", activityId);
  }

  public List<RuleView> publishedRules(long activityId) {
    return readRules("WHERE activity_id = ? AND status = 'PUBLISHED'", activityId);
  }

  private List<RuleView> readRules(String where, Object... args) {
    return jdbc.query("SELECT id, activity_id, name, status, created_at, updated_at FROM lottery_rule " + where + " ORDER BY id DESC",
        (rs, rowNum) -> new RuleView(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4),
            UtcTime.read(rs, 5), UtcTime.read(rs, 6), rounds(rs.getLong(1))), args);
  }

  public RuleView rule(long activityId, long ruleId) {
    return readRules("WHERE activity_id = ? AND id = ?", activityId, ruleId).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("LOTTERY_RULE_NOT_FOUND", "抽奖规则不存在"));
  }

  public List<ProductOption> productOptions(long activityId) {
    return jdbc.query(connection -> {
      var ps = connection.prepareStatement("""
          SELECT DISTINCT STRAIGHT_JOIN NULLIF(TRIM(i.product_line),''), NULLIF(TRIM(i.variety_name),'')
          FROM customer_order o STRAIGHT_JOIN order_item i ON i.order_id=o.id
          WHERE o.activity_id=? AND o.status='SUBMITTED'
          UNION
          SELECT NULLIF(TRIM(p.product_line),''), NULLIF(TRIM(p.variety_name),'') FROM activity_product p
          JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT'
            AND b.current_version_id=p.data_version_id WHERE p.activity_id=? AND p.data_status='ACTIVE'
          ORDER BY 1,2
          """);
      ps.setLong(1, activityId); ps.setLong(2, activityId); ps.setQueryTimeout(queryTimeoutSeconds);
      return ps;
    }, (rs,n) -> new ProductOption(rs.getString(1), rs.getString(2)));
  }

  @Transactional
  public RuleView create(long activityId, RuleWrite request, AdminPrincipal admin) {
    requireLotteryNotFinished(activityId);
    validate(activityId, request, List.of());
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
    RuleView current = rule(activityId, ruleId);
    validate(activityId, request, current.rounds());
    if ("ARCHIVED".equals(current.status())) throw DomainException.conflict("LOTTERY_RULE_READ_ONLY", "已归档规则不能修改");
    List<Long> previousPrizeImages = current.rounds().stream().map(RoundView::prizeImageFileId)
        .filter(java.util.Objects::nonNull).distinct().toList();
    jdbc.update("UPDATE lottery_rule SET name = ?, updated_by = ? WHERE id = ? AND activity_id = ?",
        request.name(), admin.id(), ruleId, activityId);
    if ("DRAFT".equals(current.status())) {
      jdbc.update("DELETE FROM lottery_round WHERE lottery_rule_id = ? AND status = 'DRAFT'", ruleId);
      replaceRounds(activityId, ruleId, request.rounds());
    } else {
      revisePublishedRounds(activityId, ruleId, current.rounds(), request.rounds());
      outbox(activityId, "LOTTERY_RULE_REVISED", String.valueOf(ruleId));
    }
    cleanupUnreferencedPrizeImages(activityId, previousPrizeImages);
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
      candidates = candidates.stream().map(value -> value.withRandom(randomBytes())).toList();
      candidates = !"EQUAL".equals(round.probabilityMode())
          ? weightedOrder(round.probabilityMode(), candidates)
          : candidates.stream().sorted(Comparator.comparing(Candidate::randomKey, LotteryService::compareBytes)).toList();
      int actualWinnerCount = Math.min(round.winnerCount(), candidates.size());
      List<Candidate> winners = candidates.subList(0, actualWinnerCount);
      int attemptNo = round.currentAttemptNo() + 1;
      byte[] resultHash = resultHash(round, attemptNo, candidates, winners);
      long attemptId = insertAttempt(activityId, round, attemptNo, candidates, resultHash, admin);

      Map<Long, Long> snapshotIds = insertSnapshots(activityId, round, attemptId, candidates);
      List<WinnerView> resultWinners = new ArrayList<>();
      List<Object[]> winnerRows = new ArrayList<>();
      int position = 0;
      for (Candidate candidate : winners) {
        position++;
        String display = displayName(round, candidate);
        winnerRows.add(new Object[] { activityId, round.id(), attemptId, snapshotIds.get(candidate.customerId()),
            candidate.customerId(), position, display });
        resultWinners.add(new WinnerView(round.id(), position, candidate.customerId(), display, candidate.customerType(),
            candidate.regionCode(), candidate.branchName(), candidate.phoneMasked()));
      }
      jdbc.batchUpdate("""
          INSERT INTO lottery_winner(activity_id, round_id, draw_attempt_id, candidate_snapshot_id,
            activity_customer_id, winner_position, dealer_display_name_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)
          """, winnerRows);
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
        request.winnerCount(), request.candidateScope(), request.customerType(), request.minimumOrderAmount(),
        request.qualificationMetric(), request.probabilityMode(), request.minimumOrderBoxCount(), null,
        request.roundNo() > 1 && request.excludePreviousWinners(), "FULL_NAME", "DRAFT", 0, null,
        null, null, null, 0, null, null, request.minimumOrderTons(), request.productLine(), request.varieties(),
        request.productLineUnassigned(), request.includeUnspecifiedVariety());
    List<Candidate> base = candidates(virtualRound, false);
    int missingTonnageCustomers = (int) base.stream().filter(c -> c.missingTonnageItems() > 0).count();
    List<Candidate> candidateValues = base.stream().filter(c -> qualifies(virtualRound, c)).toList();
    BigDecimal totalCandidateOrderAmount = amountTotal(candidateValues);
    BigDecimal totalCandidateWeight = weightedTotal(virtualRound.probabilityMode(), candidateValues);
    List<CandidatePreviewItem> items = candidateValues.stream().map(candidate -> new CandidatePreviewItem(
        candidate.customerId(), candidate.fullName(), candidate.customerType(), candidate.regionCode(), candidate.branchName(),
        candidate.phoneMasked(), request.candidateScope(), candidate.orderAmount(), candidate.orderBoxCount(),
        probabilityPercent(virtualRound, candidate, totalCandidateWeight),
        candidate.orderTons(), candidate.missingTonnageItems())).toList();
    int actualWinnerCount = Math.min(request.winnerCount(), items.size());
    return new CandidatePreview(Instant.now(), items.size(), request.winnerCount(), actualWinnerCount,
        Math.max(0, request.winnerCount() - actualWinnerCount), totalCandidateOrderAmount, items, missingTonnageCustomers,
        weightMetric(virtualRound.probabilityMode()), totalCandidateWeight);
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
    return mapRounds("WHERE r.lottery_rule_id = ?", ruleId);
  }

  private List<RoundView> mapRounds(String where, Object... args) {
    return jdbc.query("""
        SELECT r.id, r.activity_id, r.lottery_rule_id, r.round_no, r.name, r.prize_name, r.winner_count,
          r.candidate_scope, r.customer_type, r.minimum_order_amount, r.qualification_metric, r.probability_mode, r.minimum_order_box_count,
          r.qualification_cutoff_at,
          r.exclude_previous_winners, r.display_name_type, r.status, r.current_attempt_no, r.candidate_count,
          HEX(r.result_hash), r.drawn_at, r.completed_at, r.lock_version, r.prize_image_file_id,
          r.minimum_order_tons, r.product_line, r.varieties_json, r.product_line_unassigned, r.include_unspecified_variety
        FROM lottery_round r
        """ + where + " ORDER BY r.round_no", (rs, rowNum) -> {
          Long imageFileId = rs.getObject(24) == null ? null : rs.getLong(24);
          return new RoundView(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getInt(4), rs.getString(5),
              rs.getString(6), rs.getInt(7), rs.getString(8), rs.getString(9), rs.getBigDecimal(10),
              rs.getString(11), rs.getString(12), rs.getLong(13), UtcTime.read(rs, 14), rs.getBoolean(15), rs.getString(16),
              rs.getString(17), rs.getInt(18), rs.getObject(19) == null ? null : rs.getInt(19), rs.getString(20),
              UtcTime.read(rs, 21), UtcTime.read(rs, 22), rs.getInt(23), imageFileId, prizeImageUrl(imageFileId), rs.getBigDecimal("minimum_order_tons"), rs.getString("product_line"),
              readVarieties(rs.getString("varieties_json")), rs.getBoolean("product_line_unassigned"), rs.getBoolean("include_unspecified_variety"));
        }, args);
  }

  private RoundView lockRound(long activityId, long roundId) {
    List<RoundView> result = jdbc.query("""
        SELECT r.id, r.activity_id, r.lottery_rule_id, r.round_no, r.name, r.prize_name, r.winner_count,
          r.candidate_scope, r.customer_type, r.minimum_order_amount, r.qualification_metric, r.probability_mode, r.minimum_order_box_count,
          r.qualification_cutoff_at,
          r.exclude_previous_winners, r.display_name_type, r.status, r.current_attempt_no, r.candidate_count,
          HEX(r.result_hash), r.drawn_at, r.completed_at, r.lock_version, r.prize_image_file_id,
          r.minimum_order_tons, r.product_line, r.varieties_json, r.product_line_unassigned, r.include_unspecified_variety
        FROM lottery_round r JOIN lottery_rule lr ON lr.id = r.lottery_rule_id
        WHERE r.activity_id = ? AND r.id = ? AND lr.status = 'PUBLISHED' FOR UPDATE
        """, (rs, rowNum) -> {
          Long imageFileId = rs.getObject(24) == null ? null : rs.getLong(24);
          return new RoundView(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getInt(4), rs.getString(5),
              rs.getString(6), rs.getInt(7), rs.getString(8), rs.getString(9), rs.getBigDecimal(10), rs.getString(11),
              rs.getString(12), rs.getLong(13), UtcTime.read(rs, 14), rs.getBoolean(15), rs.getString(16), rs.getString(17),
              rs.getInt(18), rs.getObject(19) == null ? null : rs.getInt(19), rs.getString(20),
              UtcTime.read(rs, 21), UtcTime.read(rs, 22), rs.getInt(23), imageFileId, prizeImageUrl(imageFileId), rs.getBigDecimal("minimum_order_tons"), rs.getString("product_line"),
              readVarieties(rs.getString("varieties_json")), rs.getBoolean("product_line_unassigned"), rs.getBoolean("include_unspecified_variety"));
        }, activityId, roundId);
    if (result.isEmpty()) throw DomainException.notFound("LOTTERY_ROUND_NOT_FOUND", "已发布抽奖轮次不存在");
    return result.getFirst();
  }

  private LotteryProductFilter filter(RoundView round) {
    return "VALID_ORDERS".equals(round.candidateScope())
        ? new LotteryProductFilter(round.productLine(), round.productLineUnassigned(), round.varieties(), round.includeUnspecifiedVariety())
        : new LotteryProductFilter(null, false, List.of(), false);
  }

  private List<Candidate> candidates(RoundView round) { return candidates(round, true); }

  private boolean qualifies(RoundView round, Candidate value) {
    if (candidateWeight(round.probabilityMode(), value).signum() <= 0) return false;
    if (!"VALID_ORDERS".equals(round.candidateScope())) return true;
    if (value.orderId() == null || value.orderBoxCount() == null) return false;
    return switch (round.qualificationMetric()) {
      case "TONS" -> (value.orderTons() == null ? BigDecimal.ZERO : value.orderTons()).compareTo(round.minimumOrderTons()) >= 0;
      case "BOX_COUNT" -> value.orderBoxCount() >= round.minimumOrderBoxCount();
      default -> value.orderAmount() != null && value.orderAmount().compareTo(round.minimumOrderAmount()) >= 0;
    };
  }

  /** The same scoped aggregation serves preview and draw. No writes are added to order submission. */
  private List<Candidate> candidates(RoundView round, boolean qualifiedOnly) {
    LotteryProductFilter filter = filter(round);
    List<Object> args = new ArrayList<>(List.of(round.activityId()));
    String customerType = "";
    if (!"ALL".equals(round.customerType())) {
      customerType = " AND c.customer_type=?";
      args.add(round.customerType());
    }
    String attendance = "ATTENDEES".equals(round.candidateScope()) ? """
        AND EXISTS (SELECT 1 FROM activity_attendee a
          LEFT JOIN activity_data_binding ab ON ab.activity_id=a.activity_id AND ab.data_type='ATTENDANCE'
          WHERE a.activity_id=c.activity_id AND a.activity_customer_id=c.id AND a.is_active=TRUE
            AND a.match_status='MATCHED' AND (ab.current_version_id IS NULL OR a.data_version_id=ab.current_version_id))
        """ : "";
    String previous = round.excludePreviousWinners() ? """
        AND NOT EXISTS (SELECT 1 FROM lottery_winner pw WHERE pw.activity_id=c.activity_id
          AND pw.activity_customer_id=c.id AND pw.status='VALID')
        """ : "";
    String productWhere = "1=1";
    if (filter.productLineUnassigned()) productWhere += " AND NULLIF(TRIM(i.product_line),'') IS NULL";
    else if (filter.productLine() != null) { productWhere += " AND NULLIF(TRIM(i.product_line),'')=?"; args.add(filter.productLine()); }
    if (!filter.varieties().isEmpty() || filter.includeUnspecifiedVariety()) {
      List<String> alternatives = new ArrayList<>();
      if (!filter.varieties().isEmpty()) {
        alternatives.add("NULLIF(TRIM(i.variety_name),'') IN (" + String.join(",", java.util.Collections.nCopies(filter.varieties().size(), "?")) + ")");
        args.addAll(filter.varieties());
      }
      if (filter.includeUnspecifiedVariety()) alternatives.add("NULLIF(TRIM(i.variety_name),'') IS NULL");
      productWhere += " AND (" + String.join(" OR ", alternatives) + ")";
    }
    boolean details = filter.filtered() || "ORDER_TONS_WEIGHTED".equals(round.probabilityMode())
        || "VALID_ORDERS".equals(round.candidateScope()) && "TONS".equals(round.qualificationMetric());
    String matched = details ? """
        SELECT STRAIGHT_JOIN i.order_id,SUM(i.line_amount) amount,SUM(i.quantity) boxes,
          SUM(CASE WHEN i.ton_case_factor IS NOT NULL OR i.line_tons>0 THEN i.line_tons END) tons,
          SUM(CASE WHEN i.ton_case_factor IS NULL AND (i.line_tons IS NULL OR i.line_tons=0) THEN 1 ELSE 0 END) missing_tons
        FROM scoped_orders o STRAIGHT_JOIN order_item i ON i.order_id=o.id WHERE
        """ + productWhere + " GROUP BY i.order_id"
        : "SELECT id order_id,total_amount amount,total_quantity boxes,total_tons tons,0 missing_tons FROM scoped_orders";
    String orderJoin = "VALID_ORDERS".equals(round.candidateScope()) || !"EQUAL".equals(round.probabilityMode()) ? "JOIN" : "LEFT JOIN";
    String query = """
        WITH scoped_customers AS (
          SELECT c.id,c.activity_id,c.dealer_short_name,c.dealer_full_name,c.customer_type,c.region_code,c.branch_name,c.phone_masked
          FROM activity_customer c
          JOIN activity_data_binding wb ON wb.activity_id=c.activity_id AND wb.data_type='WHITELIST'
            AND wb.current_version_id=c.data_version_id
          WHERE c.activity_id=? AND c.is_active=TRUE
        """ + customerType + "\n" + attendance + previous + """
        ), scoped_orders AS (
          SELECT STRAIGHT_JOIN o.id,o.activity_customer_id,o.total_amount,o.total_quantity,o.total_tons
          FROM scoped_customers c STRAIGHT_JOIN customer_order o
            ON o.activity_id=c.activity_id AND o.activity_customer_id=c.id WHERE o.status='SUBMITTED'
        ), matched_items AS (
        """ + matched + """
        ) SELECT c.id,c.dealer_short_name,c.dealer_full_name,c.customer_type,c.region_code,c.branch_name,c.phone_masked,
          o.id,m.amount,m.boxes,m.tons,COALESCE(m.missing_tons,0)
        FROM scoped_customers c %s scoped_orders o ON o.activity_customer_id=c.id
        %s matched_items m ON m.order_id=o.id
        ORDER BY c.id
        """.formatted(orderJoin, orderJoin);
    List<Candidate> values = jdbc.query(connection -> {
      var ps = connection.prepareStatement(query); ps.setQueryTimeout(queryTimeoutSeconds);
      for (int i=0; i<args.size(); i++) ps.setObject(i+1,args.get(i));
      return ps;
    }, (rs,n) -> new Candidate(rs.getLong(1),rs.getString(2),rs.getString(3),rs.getString(4),rs.getString(5),
        rs.getString(6),rs.getString(7),rs.getObject(8)==null?null:rs.getLong(8),rs.getBigDecimal(9),
        rs.getObject(10)==null?null:rs.getLong(10),null,rs.getBigDecimal(11),rs.getInt(12)));
    return qualifiedOnly ? values.stream().filter(c -> qualifies(round,c)).toList() : values;
  }

  private List<Candidate> weightedOrder(String mode, List<Candidate> candidates) {
    BigDecimal total = weightedTotal(mode, candidates);
    return candidates.stream()
        .map(candidate -> new WeightedCandidate(candidate, weightedScore(candidate.randomKey(), candidateWeight(mode, candidate), total)))
        .sorted((left, right) -> {
          int scoreComparison = Double.compare(left.score(), right.score());
          return scoreComparison != 0 ? scoreComparison : compareBytes(left.candidate().randomKey(), right.candidate().randomKey());
        })
        .map(WeightedCandidate::candidate)
        .toList();
  }

  static double weightedScore(byte[] randomKey, BigDecimal weight, BigDecimal total) {
    long randomBits = ByteBuffer.wrap(randomKey, 0, Long.BYTES).getLong() >>> 11;
    double uniform = Math.min(Math.nextDown(1d), (randomBits + 0.5d) / 9007199254740992d);
    double normalizedWeight = weight.divide(total, MathContext.DECIMAL64).doubleValue();
    return -Math.log(uniform) / normalizedWeight;
  }

  private BigDecimal amountTotal(List<Candidate> candidates) {
    return candidates.stream()
        .map(Candidate::orderAmount)
        .filter(value -> value != null && value.signum() > 0)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  static String weightMetric(String mode) {
    return switch (mode) {
      case "ORDER_AMOUNT_WEIGHTED" -> "AMOUNT";
      case "ORDER_BOX_COUNT_WEIGHTED" -> "BOX_COUNT";
      case "ORDER_TONS_WEIGHTED" -> "TONS";
      default -> "EQUAL";
    };
  }

  static BigDecimal weight(String mode, BigDecimal amount, Long boxes, BigDecimal tons) {
    BigDecimal value = switch (mode) {
      case "ORDER_AMOUNT_WEIGHTED" -> amount;
      case "ORDER_BOX_COUNT_WEIGHTED" -> boxes == null ? null : BigDecimal.valueOf(boxes);
      case "ORDER_TONS_WEIGHTED" -> tons;
      default -> BigDecimal.ONE;
    };
    return value == null ? BigDecimal.ZERO : value;
  }

  private BigDecimal candidateWeight(String mode, Candidate candidate) {
    return weight(mode, candidate.orderAmount(), candidate.orderBoxCount(), candidate.orderTons());
  }

  private BigDecimal weightedTotal(String mode, List<Candidate> candidates) {
    return candidates.stream().map(candidate -> candidateWeight(mode, candidate))
        .filter(value -> value.signum() > 0).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  private BigDecimal probabilityPercent(RoundView round, Candidate candidate, BigDecimal total) {
    BigDecimal weight = candidateWeight(round.probabilityMode(), candidate);
    return weight.signum() <= 0 || total.signum() <= 0 ? BigDecimal.ZERO
        : weight.multiply(BigDecimal.valueOf(100)).divide(total, 8, RoundingMode.HALF_UP);
  }

  private long insertAttempt(long activityId, RoundView round, int attemptNo, List<Candidate> candidates, byte[] resultHash, AdminPrincipal admin) {
    int candidateCount = candidates.size();
    int actualWinnerCount = Math.min(round.winnerCount(), candidateCount);
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    Map<String, Object> snapshotValues = new LinkedHashMap<>();
    snapshotValues.put("scope", round.candidateScope());
    snapshotValues.put("customerType", round.customerType());
    snapshotValues.put("minimumOrderAmount", round.minimumOrderAmount());
    snapshotValues.put("qualificationMetric", round.qualificationMetric());
    snapshotValues.put("probabilityMode", round.probabilityMode());
    snapshotValues.put("totalCandidateOrderAmount", amountTotal(candidates));
    snapshotValues.put("weightMetric", weightMetric(round.probabilityMode()));
    snapshotValues.put("totalCandidateWeight", weightedTotal(round.probabilityMode(), candidates));
    snapshotValues.put("resultHashVersion", 2);
    snapshotValues.put("minimumOrderBoxCount", round.minimumOrderBoxCount());
    snapshotValues.put("minimumOrderTons", round.minimumOrderTons());
    snapshotValues.put("productFilter", filter(round));
    snapshotValues.put("prizeName", round.prizeName());
    snapshotValues.put("prizeImageFileId", round.prizeImageFileId());
    snapshotValues.put("excludePreviousWinners", round.excludePreviousWinners());
    snapshotValues.put("configuredWinnerCount", round.winnerCount());
    snapshotValues.put("actualWinnerCount", actualWinnerCount);
    snapshotValues.put("unawardedCount", round.winnerCount() - actualWinnerCount);
    snapshotValues.put("candidateCount", candidateCount);
    snapshotValues.put("deduplicationKey", "activity_customer.id");
    snapshotValues.put("displayNameType", round.displayNameType());
    String snapshot = toJson(snapshotValues);
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

  private Map<Long, Long> insertSnapshots(long activityId, RoundView round, long attemptId, List<Candidate> candidates) {
    jdbc.batchUpdate("""
        INSERT INTO lottery_candidate_snapshot(activity_id,round_id,draw_attempt_id,activity_customer_id,
          dealer_short_name_snapshot,dealer_full_name_snapshot,customer_type,region_code,branch_name_snapshot,
          phone_masked_snapshot,qualification_source,qualifying_order_id,qualifying_order_amount,
          qualifying_order_box_count,random_sort_key,qualifying_order_tons,missing_tonnage_items)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, candidates, 250, (ps,c) -> {
      ps.setLong(1,activityId); ps.setLong(2,round.id()); ps.setLong(3,attemptId); ps.setLong(4,c.customerId());
      ps.setString(5,c.shortName()); ps.setString(6,c.fullName()); ps.setString(7,c.customerType());
      ps.setString(8,c.regionCode()); ps.setString(9,c.branchName()); ps.setString(10,c.phoneMasked());
      ps.setString(11,round.candidateScope()); ps.setObject(12,c.orderId()); ps.setBigDecimal(13,c.orderAmount());
      ps.setObject(14,c.orderBoxCount()); ps.setBytes(15,c.randomKey()); ps.setBigDecimal(16,c.orderTons());
      ps.setInt(17,c.missingTonnageItems());
    });
    Map<Long,Long> ids = new java.util.HashMap<>();
    jdbc.query("SELECT activity_customer_id,id FROM lottery_candidate_snapshot WHERE draw_attempt_id=?",
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> ids.put(rs.getLong(1),rs.getLong(2)), attemptId);
    if (ids.size()!=candidates.size()) throw new IllegalStateException("Incomplete lottery candidate snapshot");
    return ids;
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
        && java.util.Objects.equals(before.prizeImageFileId(), after.prizeImageFileId())
        && before.winnerCount() == after.winnerCount() && before.candidateScope().equals(after.candidateScope())
        && before.customerType().equals(after.customerType())
        && before.qualificationMetric().equals(after.qualificationMetric())
        && before.probabilityMode().equals(after.probabilityMode())
        && before.minimumOrderAmount().compareTo(after.minimumOrderAmount()) == 0
        && before.minimumOrderBoxCount() == after.minimumOrderBoxCount()
        && before.minimumOrderTons().compareTo(after.minimumOrderTons()) == 0
        && filter(before).equals(new LotteryProductFilter(after.productLine(),after.productLineUnassigned(),after.varieties(),after.includeUnspecifiedVariety()))
        && (before.roundNo() == 1 || before.excludePreviousWinners() == after.excludePreviousWinners());
  }

  private void updateReadyRound(long id, int roundNo, RoundWrite round) {
    jdbc.update("""
        UPDATE lottery_round SET round_no = ?, name = ?, prize_name = ?, prize_image_file_id = ?, winner_count = ?, candidate_scope = ?,
          customer_type = ?, minimum_order_amount = ?, qualification_metric = ?, probability_mode = ?, minimum_order_box_count = ?,
          minimum_order_tons = ?, product_line = ?, varieties_json = ?, product_line_unassigned = ?, include_unspecified_variety = ?,
          qualification_cutoff_at = NULL,
          exclude_previous_winners = ?, display_name_type = ? WHERE id = ? AND status = 'READY'
        """, roundNo, round.name(), round.prizeName(), round.prizeImageFileId(), round.winnerCount(),
        round.candidateScope(), round.customerType(),
        round.minimumOrderAmount(), round.qualificationMetric(), round.probabilityMode(), round.minimumOrderBoxCount(),
        round.minimumOrderTons(), round.productLine(), toJson(round.varieties()), round.productLineUnassigned(), round.includeUnspecifiedVariety(),
        roundNo > 1 && round.excludePreviousWinners(), round.displayNameType(), id);
  }

  private void insertRound(long activityId, long ruleId, int roundNo, RoundWrite round, String status) {
    jdbc.update("""
        INSERT INTO lottery_round(activity_id, lottery_rule_id, round_no, name, prize_name, prize_image_file_id, winner_count,
          candidate_scope, customer_type, minimum_order_amount, qualification_metric, probability_mode, minimum_order_box_count, qualification_cutoff_at,
          exclude_previous_winners, display_name_type, status, minimum_order_tons, product_line, varieties_json, product_line_unassigned, include_unspecified_variety)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        """, activityId, ruleId, roundNo, round.name(), round.prizeName(), round.prizeImageFileId(),
        round.winnerCount(), round.candidateScope(), round.customerType(), round.minimumOrderAmount(),
        round.qualificationMetric(), round.probabilityMode(), round.minimumOrderBoxCount(),
        roundNo > 1 && round.excludePreviousWinners(), round.displayNameType(), status, round.minimumOrderTons(), round.productLine(), toJson(round.varieties()),
        round.productLineUnassigned(), round.includeUnspecifiedVariety());
  }

  private void validate(long activityId, RuleWrite request, List<RoundView> existing) {
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
      if (!QUALIFICATION_METRICS.contains(round.qualificationMetric()) || !PROBABILITY_MODES.contains(round.probabilityMode())
          || round.minimumOrderBoxCount() < 0) {
        throw DomainException.badRequest("LOTTERY_QUALIFICATION_INVALID", "订单门槛类型或最低订货箱数配置不正确");
      }
      if (round.minimumOrderAmount() == null || round.minimumOrderAmount().signum() < 0) throw DomainException.badRequest("LOTTERY_AMOUNT_INVALID", "最低订单金额不能小于零");
      validateTons(round.minimumOrderTons());
      validateWeightMetric(round.probabilityMode(), round.qualificationMetric());
      if ("ORDER_AMOUNT_WEIGHTED".equals(round.probabilityMode()) && !"AMOUNT".equals(round.qualificationMetric())) {
        RoundView before = roundNo <= existing.size() ? existing.get(roundNo - 1) : null;
        if (before == null || !before.probabilityMode().equals(round.probabilityMode())
            || !before.qualificationMetric().equals(round.qualificationMetric())
            || !before.candidateScope().equals(round.candidateScope())) {
          throw DomainException.badRequest("LOTTERY_WEIGHT_METRIC_MISMATCH", "金额加权须使用最低金额门槛");
        }
      }
      validatePrizeImageReference(activityId, round.prizeImageFileId());
    }
  }

  private void validatePreview(PreviewRequest request) {
    if (request != null) validateTons(request.minimumOrderTons());
    if (request == null || request.roundNo() < 1 || request.winnerCount() < 1
        || !SCOPES.contains(request.candidateScope()) || !CUSTOMER_TYPES.contains(request.customerType())
        || !QUALIFICATION_METRICS.contains(request.qualificationMetric()) || !PROBABILITY_MODES.contains(request.probabilityMode())
        || request.minimumOrderBoxCount() < 0
        || request.minimumOrderAmount() == null || request.minimumOrderAmount().signum() < 0) {
      throw DomainException.badRequest("LOTTERY_PREVIEW_INVALID", "候选试算条件不正确");
    }
    validateWeightMetric(request.probabilityMode(), request.qualificationMetric());
  }

  private void validateWeightMetric(String mode, String metric) {
    // Historical amount weighting may use a different eligibility metric; preserve those rules.
    if (("ORDER_BOX_COUNT_WEIGHTED".equals(mode) || "ORDER_TONS_WEIGHTED".equals(mode))
        && !weightMetric(mode).equals(metric)) {
      throw DomainException.badRequest("LOTTERY_WEIGHT_METRIC_MISMATCH", "箱数或吨数加权须使用对应的最低门槛");
    }
  }

  private void validateTons(BigDecimal value) {
    if (value == null || value.signum() < 0 || value.stripTrailingZeros().scale() > 6 || value.precision()-value.scale() > 12)
      throw DomainException.badRequest("LOTTERY_TONS_INVALID", "最低吨数须为非负数，最多6位小数");
  }

  private List<String> readVarieties(String value) {
    if (value == null) return List.of();
    try { return json.readValue(value, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}); }
    catch (JsonProcessingException e) { throw new IllegalStateException("Invalid stored lottery varieties",e); }
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

  private byte[] resultHash(RoundView round, int attemptNo, List<Candidate> candidates, List<Candidate> winners) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      digest.update(ByteBuffer.allocate(Long.BYTES + Integer.BYTES).putLong(round.id()).putInt(attemptNo).array());
      digest.update(round.probabilityMode().getBytes(StandardCharsets.UTF_8));
      for (Candidate candidate : candidates) {
        digest.update(ByteBuffer.allocate(Long.BYTES).putLong(candidate.customerId()).array());
        digest.update(candidate.orderAmount() == null ? new byte[0] : candidate.orderAmount().toPlainString().getBytes(StandardCharsets.UTF_8));
        digest.update(candidate.orderTons()==null ? new byte[0] : candidate.orderTons().toPlainString().getBytes(StandardCharsets.UTF_8));
        digest.update(ByteBuffer.allocate(Long.BYTES).putLong(candidate.orderBoxCount() == null ? 0 : candidate.orderBoxCount()).array());
        digest.update(candidate.randomKey());
      }
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

  private record Candidate(long customerId, String shortName, String fullName, String customerType, String regionCode,
                           String branchName, String phoneMasked, Long orderId, BigDecimal orderAmount,
                           Long orderBoxCount, byte[] randomKey, BigDecimal orderTons, int missingTonnageItems) {
    Candidate withRandom(byte[] key) {
      return new Candidate(customerId, shortName, fullName, customerType, regionCode, branchName, phoneMasked,
           orderId, orderAmount, orderBoxCount, key, orderTons, missingTonnageItems);
    }
  }
  private record WeightedCandidate(Candidate candidate, double score) {}
  public record RoundWrite(String name, String prizeName, int winnerCount, String candidateScope, String customerType,
                           BigDecimal minimumOrderAmount, String qualificationMetric, String probabilityMode, long minimumOrderBoxCount,
                           Instant qualificationCutoffAt, boolean excludePreviousWinners, String displayNameType,
                           Long prizeImageFileId, BigDecimal minimumOrderTons, String productLine, List<String> varieties,
                           boolean productLineUnassigned, boolean includeUnspecifiedVariety) {
    public RoundWrite {
      if (minimumOrderTons == null) minimumOrderTons = BigDecimal.ZERO;
      var filter = new LotteryProductFilter(productLine,productLineUnassigned,varieties,includeUnspecifiedVariety);
      productLine=filter.productLine(); varieties=filter.varieties();
      if (!"VALID_ORDERS".equals(candidateScope)) {
        productLine=null; productLineUnassigned=false; varieties=List.of(); includeUnspecifiedVariety=false;
      }
      if (minimumOrderAmount == null) minimumOrderAmount = BigDecimal.ZERO;
      if (qualificationMetric == null || qualificationMetric.isBlank()) qualificationMetric = "AMOUNT";
      if (probabilityMode == null || probabilityMode.isBlank()) probabilityMode = "EQUAL";
    }
  }
  public record RuleWrite(String name, List<RoundWrite> rounds) {}
  public record RuleView(long id, long activityId, String name, String status, Instant createdAt, Instant updatedAt,
                         List<RoundView> rounds) {}
  public record RoundView(long id, long activityId, long ruleId, int roundNo, String name, String prizeName,
                           int winnerCount, String candidateScope, String customerType, BigDecimal minimumOrderAmount,
                           String qualificationMetric, String probabilityMode, long minimumOrderBoxCount,
                          Instant qualificationCutoffAt, boolean excludePreviousWinners, String displayNameType,
                          String status, int currentAttemptNo, Integer candidateCount, String resultHash,
                          Instant drawnAt, Instant completedAt, int lockVersion, Long prizeImageFileId,
                          String prizeImageUrl, BigDecimal minimumOrderTons, String productLine, List<String> varieties,
                          boolean productLineUnassigned, boolean includeUnspecifiedVariety) {}
  public record PrizeImageView(long fileId, String url, String filename, String contentType, long sizeBytes) {}
  public record WinnerView(long roundId, int position, long activityCustomerId, String dealerDisplayName, String customerType,
                           String regionCode, String branchName, String phoneMasked) {}
  public record DrawResult(long roundId, long attemptId, int attemptNo, int candidateCount,
                           int configuredWinnerCount, int actualWinnerCount, int unawardedCount,
                           List<WinnerView> winners, String resultHash, Instant drawnAt) {}
  public record PreviewRequest(int roundNo, int winnerCount, String candidateScope, String customerType,
                               BigDecimal minimumOrderAmount, String qualificationMetric, String probabilityMode, long minimumOrderBoxCount,
                               boolean excludePreviousWinners, BigDecimal minimumOrderTons, String productLine, List<String> varieties,
                               boolean productLineUnassigned, boolean includeUnspecifiedVariety) {
    public PreviewRequest {
      if (minimumOrderTons == null) minimumOrderTons = BigDecimal.ZERO;
      var filter = new LotteryProductFilter(productLine,productLineUnassigned,varieties,includeUnspecifiedVariety);
      productLine=filter.productLine(); varieties=filter.varieties();
      if (!"VALID_ORDERS".equals(candidateScope)) {
        productLine=null; productLineUnassigned=false; varieties=List.of(); includeUnspecifiedVariety=false;
      }
      if (minimumOrderAmount == null) minimumOrderAmount = BigDecimal.ZERO;
      if (qualificationMetric == null || qualificationMetric.isBlank()) qualificationMetric = "AMOUNT";
      if (probabilityMode == null || probabilityMode.isBlank()) probabilityMode = "EQUAL";
    }
  }
  public record CandidatePreviewItem(long activityCustomerId, String dealerFullName, String customerType,
                                     String regionCode, String branchName, String phoneMasked,
                                     String qualificationSource, BigDecimal qualifyingOrderAmount,
                                     Long qualifyingOrderBoxCount, BigDecimal probabilityPercent, BigDecimal qualifyingOrderTons,
                                     int missingTonnageItems) {}
  public record CandidatePreview(Instant calculatedAt, int candidateCount, int configuredWinnerCount,
                                 int actualWinnerCount, int unawardedCount, BigDecimal totalCandidateOrderAmount,
                                 List<CandidatePreviewItem> candidates, int missingTonnageCustomers,
                                 String weightMetric, BigDecimal totalCandidateWeight) {}
  public record ProductOption(String productLine, String varietyName) {}
  public record WinnerStatistics(long validWinnerRecords, long validWinnerCustomers, long invalidatedWinnerRecords) {}
}
