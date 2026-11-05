package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TextNormalizer;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** A scope row means SELECTED, including an empty/invalidated selection (never fail open). */
@Service
public class ProductDealerScopeService {
  private final JdbcTemplate jdbc;
  public ProductDealerScopeService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  // p is the authorized product; the single parameter is an activity_customer ID.
  public static final String ALLOWED_SQL = """
      AND EXISTS (SELECT 1 FROM activity_customer dc
        JOIN activity_data_binding db ON db.activity_id=dc.activity_id AND db.data_type='WHITELIST'
          AND db.current_version_id=dc.data_version_id
        WHERE dc.id=? AND dc.activity_id=p.activity_id AND dc.is_active=TRUE
          AND (p.customer_type='ALL' OR p.customer_type=dc.customer_type)
          AND (NOT EXISTS (SELECT 1 FROM activity_product_dealer_scope ds
                 WHERE ds.activity_product_id=p.id AND ds.normalized_branch_name=dc.normalized_branch_name)
            OR EXISTS (SELECT 1 FROM activity_product_dealer_member dm
                 WHERE dm.activity_product_id=p.id AND dm.normalized_branch_name=dc.normalized_branch_name
                   AND dm.customer_id=dc.customer_id AND dm.customer_type=dc.customer_type
                   AND dm.normalized_dealer_full_name=dc.normalized_dealer_full_name)))
      """;

  public record Member(long customerId, String dealerFullName, String customerType, boolean active) {}
  public record Scope(String branchName, List<Member> members) {}
  public record Selection(String branchName, List<Long> customerIds) {}
  public record Candidate(long customerId, String dealerFullName, String dealerShortName, String branchName, String customerType) {}
  public record ScopeSummary(List<Scope> scopes, int effectiveCount, int selectedCount, boolean restricted) {}
  public List<Candidate> candidates(long activityId) {
    return jdbc.query("""
        SELECT c.* FROM activity_customer c JOIN activity_data_binding b ON b.activity_id=c.activity_id
          AND b.data_type='WHITELIST' AND b.current_version_id=c.data_version_id
        WHERE c.activity_id=? AND c.is_active=TRUE ORDER BY c.branch_name,c.dealer_full_name,c.id
        """, (rs,n) -> new Candidate(rs.getLong("customer_id"), rs.getString("dealer_full_name"),
        rs.getString("dealer_short_name"), Objects.requireNonNullElse(rs.getString("branch_name"), ""), rs.getString("customer_type")), activityId);
  }
  public Map<Long,List<Scope>> current(long activityId) {
    List<Long> ids = jdbc.queryForList("""
        SELECT p.id FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id
          AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id WHERE p.activity_id=?
        """, Long.class, activityId);
    return read(activityId, ids);
  }
  public Map<Long,ScopeSummary> summaries(long activityId) {
    List<Long> ids = jdbc.queryForList("""
        SELECT p.id FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id
          AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id WHERE p.activity_id=?
        """, Long.class, activityId);
    if (ids.isEmpty()) return Map.of();
    Map<Long,List<Scope>> scopes = read(activityId, ids);
    Map<Long,String> types = new HashMap<>();
    jdbc.query("""
        SELECT p.id,p.customer_type FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id
          AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id WHERE p.activity_id=?
        """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> types.put(rs.getLong(1),rs.getString(2)), activityId);
    Map<Long,Set<String>> branchScopes = new HashMap<>();
    jdbc.query("""
        SELECT s.activity_product_id,s.normalized_branch_name FROM activity_product_branch_scope s
        JOIN activity_product p ON p.id=s.activity_product_id JOIN activity_data_binding b ON b.activity_id=p.activity_id
          AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id WHERE p.activity_id=?
        """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> branchScopes.computeIfAbsent(rs.getLong(1),k -> new HashSet<>()).add(rs.getString(2)), activityId);
    return summarize(activityId, ids, scopes, types, branchScopes);
  }
  public Map<Long,ScopeSummary> summaries(long activityId, List<ProductService.ProductView> products) {
    var ids = products.stream().map(ProductService.ProductView::id).toList();
    if (ids.isEmpty()) return Map.of();
    Map<Long,String> types = new HashMap<>();
    Map<Long,Set<String>> branches = new HashMap<>();
    for (var product : products) {
      types.put(product.id(), product.customerType());
      branches.put(product.id(), product.branchScope().stream().map(TextNormalizer::normalize).collect(java.util.stream.Collectors.toSet()));
    }
    return summarize(activityId, ids, read(activityId, ids), types, branches);
  }
  private Map<Long,ScopeSummary> summarize(long activityId, List<Long> ids, Map<Long,List<Scope>> scopes,
      Map<Long,String> types, Map<Long,Set<String>> branchScopes) {
    Map<String,Candidate> candidates = new HashMap<>();
    candidates(activityId).forEach(c -> candidates.put(c.customerId()+":"+TextNormalizer.normalize(c.branchName()),c));
    Map<Long,ScopeSummary> result = new LinkedHashMap<>();
    for(long id: ids) {
      String type=types.getOrDefault(id,"ALL"); Set<String> branches=branchScopes.getOrDefault(id,Set.of());
      List<Scope> rows=scopes.getOrDefault(id,List.of()); Map<String,Scope> byBranch=rows.stream().collect(java.util.stream.Collectors.toMap(s -> TextNormalizer.normalize(s.branchName()),s -> s,(a,b)->a));
      int effective=0, selected=0;
      for(Candidate c:candidates.values()) {
        if(!"ALL".equals(type) && !type.equals(c.customerType())) continue;
        String branch=TextNormalizer.normalize(c.branchName());
        if(!branches.isEmpty() && !branches.contains(branch)) continue;
        Scope scope=byBranch.get(branch);
        if(scope==null || scope.members().stream().anyMatch(m -> m.customerId()==c.customerId() && m.active())) effective++;
      }
      selected=rows.stream().flatMap(s -> s.members().stream()).filter(Member::active).mapToInt(x -> 1).sum();
      result.put(id,new ScopeSummary(rows,effective,selected,!branches.isEmpty() || !rows.isEmpty()));
    }
    return result;
  }
  public Map<Long,List<Scope>> read(long activityId, List<Long> ids) {
    Map<Long,List<Scope>> result = new LinkedHashMap<>();
    if (ids.isEmpty()) return result;
    if (ids.size() > 500) {
      for(int start=0;start<ids.size();start+=500) result.putAll(read(activityId,ids.subList(start,Math.min(start+500,ids.size()))));
      return result;
    }
    String idFilter=" AND p.id IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")";
    List<Object> args=new ArrayList<>(); args.add(activityId); args.addAll(ids);
    // Bound SQL batches; do not load retired versions or any contact details.
    Set<Long> wanted = new HashSet<>(ids);
    Map<String,List<Member>> members = new HashMap<>();
    jdbc.query("""
        SELECT m.*, EXISTS (SELECT 1 FROM activity_customer c JOIN activity_data_binding b
          ON b.activity_id=c.activity_id AND b.data_type='WHITELIST' AND b.current_version_id=c.data_version_id
          WHERE c.activity_id=p.activity_id AND c.customer_id=m.customer_id AND c.is_active=TRUE
            AND c.customer_type=m.customer_type AND c.normalized_branch_name=m.normalized_branch_name
            AND c.normalized_dealer_full_name=m.normalized_dealer_full_name
            AND (p.customer_type='ALL' OR p.customer_type=c.customer_type)) valid
        FROM activity_product_dealer_member m JOIN activity_product p ON p.id=m.activity_product_id
        WHERE p.activity_id=?
        """ + idFilter, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
          long id=rs.getLong("activity_product_id"); if (!wanted.contains(id)) return;
          members.computeIfAbsent(id+":"+rs.getString("normalized_branch_name"), k -> new ArrayList<>())
            .add(new Member(rs.getLong("customer_id"),rs.getString("dealer_full_name"),rs.getString("customer_type"),rs.getBoolean("valid")));
        }, args.toArray());
    jdbc.query("""
        SELECT s.* FROM activity_product_dealer_scope s JOIN activity_product p ON p.id=s.activity_product_id
        WHERE p.activity_id=?
        """ + idFilter + " ORDER BY s.activity_product_id,s.branch_name", (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
          long id=rs.getLong("activity_product_id"); if (!wanted.contains(id)) return;
          result.computeIfAbsent(id,k -> new ArrayList<>()).add(new Scope(rs.getString("branch_name"),
              members.getOrDefault(id+":"+rs.getString("normalized_branch_name"),List.of())));
        }, args.toArray());
    return result;
  }
  public void replace(long activityId, long productId, String customerType, List<String> branches, List<Selection> selections) {
    if (selections == null) return;
    if (!selections.isEmpty() && branches.isEmpty()) throw DomainException.badRequest("DEALER_SCOPE_BRANCH_REQUIRED", "指定经销商前请先选择分公司");
    Map<Long,Candidate> candidates = new HashMap<>();
    candidates(activityId).forEach(c -> candidates.put(c.customerId(),c));
    Set<String> allowedBranches = new HashSet<>(); branches.forEach(b -> allowedBranches.add(TextNormalizer.normalize(b)));
    Set<String> seen = new HashSet<>();
    for (Selection selection : selections) {
      if (selection == null || selection.branchName() == null) throw DomainException.badRequest("DEALER_SCOPE_INVALID", "经销商限制格式不正确");
      String branch=TextNormalizer.normalize(selection.branchName());
      if (!seen.add(branch) || (!allowedBranches.isEmpty() && !allowedBranches.contains(branch)))
        throw DomainException.badRequest("DEALER_SCOPE_BRANCH_INVALID", "经销商限制的分公司不在允许范围内或重复");
      if (selection.customerIds()==null || selection.customerIds().isEmpty())
        throw DomainException.badRequest("DEALER_SCOPE_EMPTY", "指定经销商时请至少选择一家；允许全部请切换为不限制");
      for (Long id : selection.customerIds()) {
        Candidate c=candidates.get(id);
        if(c==null || !TextNormalizer.normalize(c.branchName()).equals(branch)
            || !(customerType.equals("ALL") || c.customerType().equals(customerType)))
          throw DomainException.badRequest("DEALER_SCOPE_CUSTOMER_INVALID", "所选经销商已失效或不属于商品客户类型、分公司，请重新选择");
      }
    }
    jdbc.update("DELETE FROM activity_product_dealer_member WHERE activity_product_id=?",productId);
    jdbc.update("DELETE FROM activity_product_dealer_scope WHERE activity_product_id=?",productId);
    for(Selection selection: selections) {
      String branch=TextNormalizer.normalize(selection.branchName());
      jdbc.update("INSERT INTO activity_product_dealer_scope VALUES (?,?,?)",productId,branch,selection.branchName());
      for(Long id: new LinkedHashSet<>(selection.customerIds())) {
        Candidate c=candidates.get(id);
        jdbc.update("INSERT INTO activity_product_dealer_member VALUES (?,?,?,?,?,?)", productId,branch,id,c.customerType(),TextNormalizer.normalize(c.dealerFullName()),c.dealerFullName());
      }
    }
  }
  public void pruneBranches(long productId, List<String> branches) {
    if(branches.isEmpty()) return;
    List<String> keys=branches.stream().map(TextNormalizer::normalize).toList();
    String placeholders=String.join(",",Collections.nCopies(keys.size(),"?"));
    List<Object> args=new ArrayList<>(); args.add(productId); args.addAll(keys);
    jdbc.update("DELETE FROM activity_product_dealer_member WHERE activity_product_id=? AND normalized_branch_name NOT IN ("+placeholders+")",args.toArray());
    jdbc.update("DELETE FROM activity_product_dealer_scope WHERE activity_product_id=? AND normalized_branch_name NOT IN ("+placeholders+")",args.toArray());
  }
  public void inherit(long activityId, long versionId) {
    // Exact business identity and exact normalized branch set in the SAME activity are required.
    List<ProductPair> pairs = jdbc.query("""
        SELECT n.id new_product_id, o.id old_product_id
        FROM activity_product n
        JOIN activity_data_binding b ON b.activity_id=n.activity_id AND b.data_type='PRODUCT'
        JOIN activity_product o ON o.activity_id=n.activity_id AND o.data_version_id=b.current_version_id
          AND o.business_key=n.business_key
        WHERE n.activity_id=? AND n.data_version_id=?
        """, (rs, rowNum) -> new ProductPair(rs.getLong("new_product_id"), rs.getLong("old_product_id")), activityId, versionId);
    for (ProductPair pair : pairs) {
      if (!branchSet(pair.newProductId()).equals(branchSet(pair.oldProductId()))) continue;
      jdbc.update("""
          INSERT INTO activity_product_dealer_scope(activity_product_id, normalized_branch_name, branch_name)
          SELECT ?, normalized_branch_name, branch_name FROM activity_product_dealer_scope WHERE activity_product_id=?
          """, pair.newProductId(), pair.oldProductId());
      jdbc.update("""
          INSERT INTO activity_product_dealer_member(activity_product_id, normalized_branch_name, customer_id,
            customer_type, normalized_dealer_full_name, dealer_full_name)
          SELECT ?, normalized_branch_name, customer_id, customer_type, normalized_dealer_full_name, dealer_full_name
          FROM activity_product_dealer_member WHERE activity_product_id=?
          """, pair.newProductId(), pair.oldProductId());
    }
  }

  private Set<String> branchSet(long productId) {
    return new LinkedHashSet<>(jdbc.queryForList(
        "SELECT normalized_branch_name FROM activity_product_branch_scope WHERE activity_product_id=? ORDER BY normalized_branch_name",
        String.class, productId));
  }

  private record ProductPair(long newProductId, long oldProductId) {}
}
