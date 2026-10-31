package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static com.fengyi.ordershow.dashboard.DashboardService.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

/** Actual MySQL rows; real HTTP submissions are measured separately by ranking-event.mjs. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_RANKING_SCALE_TEST",matches="order-show-e2e")
class RankingScaleIntegrationTest extends RankingFiltersIntegrationTest {
  @Test void threeThousandOrdersUseOriginalSummariesAndOnDemandProductDetails() throws Exception {
    for (String table : List.of("order_item","customer_order","domain_event_outbox")) jdbc.update("DELETE FROM "+table);
    String digits = "(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
    jdbc.execute("DROP TABLE IF EXISTS scale_numbers");
    jdbc.execute("CREATE TABLE scale_numbers AS SELECT a.n+10*b.n+100*c.n+1000*d.n+1 n FROM "+digits+" a CROSS JOIN "+digits+" b CROSS JOIN "+digits+" c CROSS JOIN "+digits+" d");
    jdbc.update("""
        INSERT INTO customer_order
        SELECT n,1,'SUBMITTED',CASE MOD(n,3) WHEN 0 THEN 'GENERAL' WHEN 1 THEN 'SPECIAL' ELSE 'ALL' END,
          CONCAT('R',MOD(n,4)),CONCAT('客户',n),CONCAT('分公司',MOD(n,30)),20000,200,'2026-10-30 00:00:00',0
        FROM scale_numbers WHERE n<=3000
        """);
    jdbc.update("""
        INSERT INTO order_item(order_id,activity_product_id,product_line,variety_name,line_amount,quantity,line_tons,ton_case_factor)
        SELECT o.id,p.n,CONCAT('项目',MOD(p.n,4)),CONCAT('品种',MOD(p.n,20)),100,1,0.001,1000
        FROM customer_order o CROSS JOIN scale_numbers p WHERE p.n<=200
        """);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_item",Integer.class)).isEqualTo(600000);
    var all = filter(null,null,null,null,RankingMetric.AMOUNT);
    var product = filter(null,null,"项目0",null,RankingMetric.AMOUNT);
    var narrow = filter("SPECIAL","R1","项目0",List.of("品种0","品种4"),RankingMetric.AMOUNT);
    var tons = filter("SPECIAL","R1","项目0",List.of("品种0","品种4"),RankingMetric.TONS);
    configure(false);
    var expected = List.of(all,product,narrow,tons).stream().map(f -> business(read(f))).toList();
    total(read(all),"total_amount","60000000"); total(read(all),"total_tons","600");
    total(read(narrow),"total_amount","500000"); total(read(narrow),"order_count","250");
    configure(true);
    jdbc.update("INSERT INTO order_dashboard_stat(order_id,item_count,all_tons,eligible_tons,dirty) SELECT id,200,0.2,0.2,FALSE FROM customer_order");
    assertThat(List.of(all,product,narrow,tons).stream().map(f -> business(read(f))).toList()).isEqualTo(expected);
    var report = new LinkedHashMap<String,Object>();
    report.put("orders",3000); report.put("items",600000);
    report.put("original_summary_all",measure(20,() -> read(all)));
    report.put("on_demand_project",measure(20,() -> read(product)));
    report.put("on_demand_four_dimensions",measure(20,() -> read(narrow)));
    report.put("on_demand_tons",measure(20,() -> read(tons)));
    report.put("options",measure(10,() -> service.options("filter")));
    var plans = new LinkedHashMap<String,Object>();
    var traced = new JdbcTemplate(source) {
      @Override public void query(String sql, RowCallbackHandler handler, Object... args) {
        plans.put("sql",sql); plans.put("arguments",Arrays.asList(args));
        plans.put("explain_analyze",jdbc.queryForList("EXPLAIN ANALYZE "+sql,String.class,args));
        super.query(sql,handler,args);
      }
    };
    new RankingService(traced,activities,store,summaries).ranking("filter",narrow);
    report.put("narrow_plan",new LinkedHashMap<>(plans));
    new RankingService(traced,activities,store,summaries).ranking("filter",product);
    report.put("project_plan",new LinkedHashMap<>(plans));
    tx.executeWithoutResult(s -> {
      jdbc.update("UPDATE order_item SET line_amount=101 WHERE order_id=1 AND activity_product_id=4");
      jdbc.update("UPDATE customer_order SET total_amount=20001,lock_version=1 WHERE id=1");
      summaries.refresh(1);
    });
    total(read(narrow),"total_amount","500001"); total(read(all),"total_amount","60000001");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'order_ranking_%'",Integer.class)).isZero();
    jdbc.update("UPDATE order_item SET variety_name=CONCAT('SKU',activity_product_id)");
    var distinct = filter("SPECIAL","R1","项目0",List.of("SKU4","SKU8"),RankingMetric.AMOUNT);
    total(read(distinct),"total_amount","50001");
    report.put("distinct_variety_four_dimensions",measure(20,() -> read(distinct)));
    report.put("distinct_variety_project",measure(10,() -> read(product)));
    var path=java.nio.file.Path.of(System.getProperty("basedir","."),"..","outputs","ranking-on-demand-scale-results.json");
    java.nio.file.Files.createDirectories(path.getParent());
    java.nio.file.Files.writeString(path,JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report));
    System.out.println("RANKING_SCALE "+JSON.writeValueAsString(report));
    jdbc.execute("DROP TABLE scale_numbers");
  }

  static Map<String,Object> measure(int samples,Runnable action) {
    action.run(); var values=new ArrayList<Double>();
    for(int i=0;i<samples;i++) { long time=System.nanoTime(); action.run(); values.add((System.nanoTime()-time)/1_000_000.0); }
    return percentiles(values);
  }
  static Map<String,Object> percentiles(List<Double> values) {
    var sorted=new ArrayList<>(values); Collections.sort(sorted);
    return Map.of("samples",sorted.size(),"p50_ms",sorted.get((int)Math.ceil(sorted.size()*.5)-1),
        "p95_ms",sorted.get((int)Math.ceil(sorted.size()*.95)-1),"max_ms",sorted.getLast());
  }
}
