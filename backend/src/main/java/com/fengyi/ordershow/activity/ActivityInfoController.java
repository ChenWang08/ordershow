package com.fengyi.ordershow.activity;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class ActivityInfoController {
  private final ActivityInfoStreamService streams;
  public ActivityInfoController(ActivityInfoStreamService streams) { this.streams = streams; }

  @GetMapping(value = "/public/activities/{activityCode}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter events(@PathVariable String activityCode, HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    return streams.subscribe(activityCode);
  }
}
