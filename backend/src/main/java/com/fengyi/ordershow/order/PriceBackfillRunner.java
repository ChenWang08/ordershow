package com.fengyi.ordershow.order;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "order-show.price-backfill-enabled", havingValue = "true", matchIfMissing = true)
@org.springframework.core.annotation.Order(200)
public class PriceBackfillRunner implements ApplicationRunner {
  private final PriceSyncService service;
  private final long activityId;
  public PriceBackfillRunner(PriceSyncService service,@Value("${PRICE_SYNC_BACKFILL_ACTIVITY_ID:0}") long activityId) {
    this.service=service; this.activityId=activityId;
  }
  public void run(ApplicationArguments args) {
    if(activityId>0) org.slf4j.LoggerFactory.getLogger(getClass()).info("Price backfill activity={}, updated lines={}",activityId,service.backfill(activityId));
  }
}
