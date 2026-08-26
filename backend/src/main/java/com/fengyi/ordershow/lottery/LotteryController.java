package com.fengyi.ordershow.lottery;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LotteryController {
  private final LotteryService service;
  private final AuthService auth;
  private final ActivityService activities;

  public LotteryController(LotteryService service, AuthService auth, ActivityService activities) {
    this.service = service; this.auth = auth; this.activities = activities;
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

  @PostMapping("/admin/activities/{activityId}/lottery/candidates/preview")
  ApiResponse<LotteryService.CandidatePreview> preview(@PathVariable long activityId,
      @RequestBody LotteryService.PreviewRequest body, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.preview(activityId, body), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/lottery/statistics")
  ApiResponse<LotteryService.WinnerStatistics> statistics(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.winnerStatistics(activityId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/lottery/rounds/{roundId}/draw")
  ApiResponse<LotteryService.DrawResult> draw(@PathVariable long activityId, @PathVariable long roundId,
      HttpServletRequest request) {
    return ApiResponse.of(service.draw(activityId, roundId, auth.requireAdmin(request)), TraceFilter.id(request));
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
    List<LotteryService.RuleView> rules = service.rules(activityId).stream().filter(rule -> "PUBLISHED".equals(rule.status())).toList();
    return ApiResponse.of(new PublicLottery(rules, service.publicWinners(activityId)), TraceFilter.id(request));
  }

  public record ResetRequest(String reason) {}
  public record PublicLottery(List<LotteryService.RuleView> rules, List<LotteryService.WinnerView> winners) {}
}
