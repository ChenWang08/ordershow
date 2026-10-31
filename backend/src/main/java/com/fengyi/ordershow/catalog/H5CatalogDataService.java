package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Context is a single indexed read; catalog data is loaded as one committed, immutable snapshot. */
@Service
public class H5CatalogDataService {
  private final JdbcTemplate jdbc;
  private final ProductCatalogReader legacy;
  private final MeterRegistry metrics;
  private static final String COLUMNS = """
      p.id,p.material_code,p.material_name,p.description,p.category_name,p.product_line,p.brand_name,p.variety_name,
      p.specification,p.case_pack,p.bottle_price,p.case_price,p.ton_case_factor,p.customer_type,p.rebate_status,
      p.is_gift_box,p.is_visible,p.is_orderable,p.data_status,p.sort_no,p.lock_version
      """;

  public H5CatalogDataService(JdbcTemplate jdbc, ProductCatalogReader legacy, MeterRegistry metrics) {
    this.jdbc = jdbc; this.legacy = legacy; this.metrics = metrics;
  }

  public Context context(String code, H5Principal customer) {
    var timer = io.micrometer.core.instrument.Timer.start(metrics);
    try {
      var rows = jdbc.query("""
          SELECT a.id,a.product_catalog_version,COALESCE(pb.current_version_id,0) product_version,
            c.id customer_row,c.customer_id,c.customer_type,c.branch_name,
            HEX(WEIGHT_STRING(COALESCE(c.normalized_branch_name,''))) branch_key,
            HEX(WEIGHT_STRING(c.normalized_branch_name)) dealer_branch_key,
            HEX(WEIGHT_STRING(c.normalized_dealer_full_name)) dealer_name_key,
            (c.is_active=TRUE AND c.data_version_id=wb.current_version_id
              AND d.status='ACTIVE' AND a.status IN ('SCHEDULED','ACTIVE','CLOSED')
              AND (a.event_ends_at IS NULL OR a.event_ends_at>UTC_TIMESTAMP(3))) permitted
          FROM activity a JOIN department d ON d.id=a.department_id
          LEFT JOIN activity_data_binding pb ON pb.activity_id=a.id AND pb.data_type='PRODUCT'
          LEFT JOIN activity_data_binding wb ON wb.activity_id=a.id AND wb.data_type='WHITELIST'
          LEFT JOIN activity_customer c ON c.id=? AND c.activity_id=a.id
          WHERE a.activity_code=? AND a.archived_at IS NULL
          """, (rs, row) -> {
            if (rs.getLong("id") != customer.activityId()) {
              throw DomainException.forbidden("H5_ACTIVITY_MISMATCH", "当前身份不属于该活动");
            }
            if (!rs.getBoolean("permitted")) throw DomainException.unauthorized("客户身份已变化，请重新验证手机号");
            return new Context(rs.getLong("id"), rs.getLong("product_catalog_version"), rs.getLong("product_version"),
                rs.getLong("customer_row"), rs.getLong("customer_id"), rs.getString("customer_type"),
                rs.getString("branch_name"), rs.getString("branch_key"), rs.getString("dealer_branch_key"), rs.getString("dealer_name_key"));
          }, customer.customerId(), code);
      if (rows.isEmpty()) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
      return rows.getFirst();
    } finally { timer.stop(metrics.timer("order_show.h5.catalog.stage", "stage", "context")); }
  }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 5)
  public Snapshot load(long activityId, Snapshot base, Change change) {
    var timer = io.micrometer.core.instrument.Timer.start(metrics);
    try {
      long[] header = jdbc.queryForObject("""
          SELECT a.product_catalog_version,COALESCE(b.current_version_id,0)
          FROM activity a LEFT JOIN activity_data_binding b ON b.activity_id=a.id AND b.data_type='PRODUCT'
          WHERE a.id=? AND a.archived_at IS NULL
          """, (rs, row) -> new long[]{rs.getLong(1), rs.getLong(2)}, activityId);
      if (header == null) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
      boolean partial = base != null && change != null && !change.fullReload()
          && base.productVersion() == header[1] && base.version() >= change.fromVersion() - 1
          && base.version() < change.toVersion() && header[0] == change.toVersion();
      Set<Long> ids = partial ? change.productIds() : Set.of();
      if (partial && ids.isEmpty()) partial = false;
      var products = new LinkedHashMap<Long, H5Product>();
      var rules = new HashMap<Long, Rule>();
      if (partial) {
        base.products().forEach(product -> { if (!ids.contains(product.id())) products.put(product.id(), product); });
        base.rules().forEach((id, rule) -> { if (!ids.contains(id)) rules.put(id, rule); });
      }
      if (header[1] != 0) {
        String filter = partial ? " AND p.id IN (" + ids.stream().map(id -> "?").collect(Collectors.joining(",")) + ")" : "";
        var args = new ArrayList<Object>(List.of(activityId, header[1]));
        if (partial) args.addAll(ids);
        var selected = legacy.withDetails(jdbc.query("SELECT " + COLUMNS + " FROM activity_product p"
            + " WHERE p.activity_id=? AND p.data_version_id=? AND p.is_visible=TRUE" + filter + " ORDER BY p.sort_no,p.id",
            legacy::map, args.toArray()));
        selected.forEach(product -> products.put(product.id(), H5Product.from(product)));
        rules.putAll(loadRules(activityId, header[1], partial ? ids : Set.of()));
      }
      metrics.counter("order_show.h5.catalog.loads", "kind", partial ? "partial" : "full").increment();
      return new Snapshot(activityId, header[0], header[1], products.values().stream()
          .sorted(Comparator.comparingInt(H5Product::sortNo).thenComparingLong(H5Product::id)).toList(), rules);
    } finally { timer.stop(metrics.timer("order_show.h5.catalog.stage", "stage", "snapshot")); }
  }

  private Map<Long, Rule> loadRules(long activityId, long versionId, Set<Long> ids) {
    String filter = ids.isEmpty() ? "" : " AND p.id IN (" + ids.stream().map(id -> "?").collect(Collectors.joining(",")) + ")";
    var args = new ArrayList<Object>();
    var parts = new ArrayList<String>();
    // MySQL collation weights preserve the database's case/accent equality, including business names.
    for (String table : List.of("activity_product_branch_scope", "activity_product_dealer_scope", "activity_product_dealer_member")) {
      boolean member = table.endsWith("member");
      String kind = table.endsWith("branch_scope") ? "BRANCH" : member ? "MEMBER" : "RESTRICTED";
      parts.add("SELECT '" + kind + "' kind,s.activity_product_id,HEX(WEIGHT_STRING(s.normalized_branch_name)) branch_key,"
          + (member ? "s.customer_id,s.customer_type,HEX(WEIGHT_STRING(s.normalized_dealer_full_name)) dealer_key" : "0 customer_id,NULL customer_type,NULL dealer_key")
          + " FROM " + table + " s JOIN activity_product p ON p.id=s.activity_product_id"
          + " WHERE p.activity_id=? AND p.data_version_id=? AND p.is_visible=TRUE" + filter);
      args.add(activityId); args.add(versionId); args.addAll(ids);
    }
    Map<Long, Set<String>> branches = new HashMap<>();
    Map<Long, Map<String, Set<Member>>> dealers = new HashMap<>();
    jdbc.query(String.join(" UNION ALL ", parts), (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
      long id = rs.getLong("activity_product_id"); String branch = rs.getString("branch_key");
      if ("BRANCH".equals(rs.getString("kind"))) branches.computeIfAbsent(id, ignored -> new HashSet<>()).add(branch);
      else {
        var members = dealers.computeIfAbsent(id, ignored -> new HashMap<>()).computeIfAbsent(branch, ignored -> new HashSet<>());
        if ("MEMBER".equals(rs.getString("kind"))) members.add(new Member(rs.getLong("customer_id"), rs.getString("customer_type"), rs.getString("dealer_key")));
      }
    }, args.toArray());
    var result = new HashMap<Long, Rule>();
    var keys = new HashSet<>(branches.keySet()); keys.addAll(dealers.keySet());
    keys.forEach(id -> result.put(id, new Rule(branches.getOrDefault(id, Set.of()), dealers.getOrDefault(id, Map.of()))));
    return result;
  }

  public List<H5Product> legacy(String code, Context context, H5Principal original, String rebate, String keyword) {
    var current = new H5Principal(original.sessionId(), context.activityId(), context.customerRow(), code,
        context.customerType(), original.regionCode(), context.branchName(), original.dealerShortName(), original.dealerFullName(), original.phoneMasked());
    return legacy.h5Products(code, current, rebate, keyword).stream().map(H5Product::from).toList();
  }

  public record Context(long activityId, long version, long productVersion, long customerRow, long dealerId,
      String customerType, String branchName, String branchKey, String dealerBranchKey, String dealerNameKey) {}
  public record Member(long id, String type, String nameKey) {}
  public record Rule(Set<String> branches, Map<String, Set<Member>> dealers) {
    public Rule {
      branches = Set.copyOf(branches);
      var copy = new HashMap<String, Set<Member>>(); dealers.forEach((key, members) -> copy.put(key, Set.copyOf(members)));
      dealers = Map.copyOf(copy);
    }
    public boolean allows(Context customer) {
      if (!branches.isEmpty() && !branches.contains(customer.branchKey())) return false;
      if (customer.dealerBranchKey() == null || !dealers.containsKey(customer.dealerBranchKey())) return true;
      return customer.dealerNameKey() != null && dealers.get(customer.dealerBranchKey())
          .contains(new Member(customer.dealerId(), customer.customerType(), customer.dealerNameKey()));
    }
  }
  public record Snapshot(long activityId, long version, long productVersion,
      List<H5Product> products, Map<Long, Rule> rules) {
    public Snapshot { products = List.copyOf(products); rules = Map.copyOf(rules); }
    public List<H5Product> visible(Context customer) {
      return products.stream().filter(product -> product.visible()
          && ("ALL".equals(product.customerType()) || product.customerType().equals(customer.customerType()))
          && rules.getOrDefault(product.id(), EMPTY_RULE).allows(customer)).toList();
    }
  }
  private static final Rule EMPTY_RULE = new Rule(Set.of(), Map.of());

  public record Change(long activityId, long fromVersion, long toVersion, Set<Long> productIds, boolean fullReload) {
    public Change { productIds = Set.copyOf(productIds); }
  }
}
