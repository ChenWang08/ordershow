package com.fengyi.ordershow.activity;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class ActivityInfoController {
  private final ActivityInfoStreamService streams;
  private final ActivityInfoHttpService http;
  public ActivityInfoController(ActivityInfoStreamService streams, ActivityInfoHttpService http) { this.streams = streams; this.http = http; }

  @GetMapping(value = "/public/activities/{activityCode}", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<ApiResponse<ActivityService.ActivityView>> activity(@PathVariable String activityCode,
      @RequestHeader(value = "If-None-Match", required = false) String conditional, HttpServletRequest request) {
    var result = http.read(activityCode, conditional);
    var response = ResponseEntity.status(result.activity() == null ? 304 : 200)
        .eTag(result.etag()).header("Cache-Control", "private, no-cache");
    return result.activity() == null ? response.build() : response.body(ApiResponse.of(result.activity(), TraceFilter.id(request)));
  }

  @GetMapping(value = "/public/activities/{activityCode}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter events(@PathVariable String activityCode, HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    return streams.subscribe(activityCode);
  }
}
