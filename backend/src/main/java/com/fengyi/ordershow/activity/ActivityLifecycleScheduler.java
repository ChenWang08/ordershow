package com.fengyi.ordershow.activity;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Invoke through the service proxy so timed transitions and their side effects commit together. */
@Component
public class ActivityLifecycleScheduler {
  private final ActivityService activities;

  public ActivityLifecycleScheduler(ActivityService activities) { this.activities = activities; }

  @Scheduled(fixedDelay = 30_000)
  public void synchronize() { activities.synchronizeTimedActivities(); }
}
