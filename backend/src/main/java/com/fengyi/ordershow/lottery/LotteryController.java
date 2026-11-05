package com.fengyi.ordershow.lottery;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LotteryController {
  private final LotteryService service;
  private final AuthService auth;
  private final ActivityService activities;

  public LotteryController(LotteryService service, AuthService auth, ActivityService activities) {
    this.service = service; this.auth = auth; this.activities = activities;
  }

  @PostMapping("/admin/activities/{activityId}/lottery/prize-images")
  ApiResponse<LotteryService.PrizeImageView> uploadPrizeImage(@PathVariable long activityId,
      @RequestParam MultipartFile file, HttpServletRequest request) {
    return ApiResponse.of(service.uploadPrizeImage(activityId, file, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/lottery/prize-images/{fileId}")
  ApiResponse<Boolean> deleteUnattachedPrizeImage(@PathVariable long activityId, @PathVariable long fileId,
      HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.deleteUnattachedPrizeImage(activityId, fileId), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/lottery/rules")
  ApiResponse<List<LotteryService.RuleView>> rules(@PathVariable long activityId, HttpServletRequest request) {
    return ApiResponse.of(service.rules(activityId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rules")
  ApiResponse<LotteryService.RuleView> create(@PathVariable long activityId, @RequestBody LotteryService.RuleWrite body,
      HttpServletRequest request) {
    return ApiResponse.of(service.create(activityId, body, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}/lottery/rules/{ruleId}")
  ApiResponse<LotteryService.RuleView> update(@PathVariable long activityId, @PathVariable long ruleId,
      @RequestBody LotteryService.RuleWrite body, HttpServletRequest request) {
    return ApiResponse.of(service.update(activityId, ruleId, body, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rules/{ruleId}/publish")
  ApiResponse<LotteryService.RuleView> publish(@PathVariable long activityId, @PathVariable long ruleId,
      HttpServletRequest request) {
    return ApiResponse.of(service.publish(activityId, ruleId, auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/lottery/rules/{ruleId}/round-order")
  ApiResponse<LotteryService.RoundOrderView> roundOrder(@PathVariable long activityId, @PathVariable long ruleId,
      HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.roundOrder(activityId, ruleId), TraceFilter.id(request));
  }

  @PutMapping("/admin/activities/{activityId}/lottery/rules/{ruleId}/round-order")
  ApiResponse<LotteryService.RoundOrderView> reorder(@PathVariable long activityId, @PathVariable long ruleId,
      @RequestBody LotteryService.RoundOrderWrite body, HttpServletRequest request) {
    var result = service.reorder(activityId, ruleId, body, auth.requireAdmin(request), TraceFilter.id(request));
    request.setAttribute(AuditService.RECORDED_REQUEST_ATTRIBUTE, true);
    return ApiResponse.of(result, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/candidates/preview")
  ApiResponse<LotteryService.CandidatePreview> preview(@PathVariable long activityId,
      @RequestBody LotteryService.PreviewRequest body, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.preview(activityId, body), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/lottery/product-options")
  ApiResponse<List<LotteryService.ProductOption>> productOptions(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.productOptions(activityId),TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/lottery/statistics")
  ApiResponse<LotteryService.WinnerStatistics> statistics(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.winnerStatistics(activityId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rounds/{roundId}/draw")
  ApiResponse<LotteryService.DrawResult> draw(@PathVariable long activityId, @PathVariable long roundId,
      @RequestBody DrawRequest body, HttpServletRequest request) {
    if (body.expectedRevision() == null) throw DomainException.conflict("LOTTERY_RULE_CHANGED", "请重新加载并确认轮次后开始抽奖");
    return ApiResponse.of(service.draw(activityId, roundId, auth.requireAdmin(request), body.expectedRevision()), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rounds/{roundId}/complete")
  ApiResponse<LotteryService.RoundView> complete(@PathVariable long activityId, @PathVariable long roundId,
      HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.complete(activityId, roundId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rounds/{roundId}/reset")
  ApiResponse<LotteryService.RoundView> reset(@PathVariable long activityId, @PathVariable long roundId,
      @RequestBody ResetRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.reset(activityId, roundId, body.reason(), auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @GetMapping("/public/activities/{activityCode}/lottery")
  ApiResponse<PublicLottery> publicLottery(@PathVariable String activityCode, HttpServletRequest request) {
    long activityId = activities.byCode(activityCode).id();
    List<LotteryService.RuleView> rules = service.publishedRules(activityId);
    return ApiResponse.of(new PublicLottery(rules, service.publicWinners(activityId)), TraceFilter.id(request));
  }

  public record ResetRequest(String reason) {}
  public record DrawRequest(Long expectedRevision) {}
  public record PublicLottery(List<LotteryService.RuleView> rules, List<LotteryService.WinnerView> winners) {}
}
