package com.fengyi.ordershow.customer;

import com.fengyi.ordershow.activity.ActivityInfoChanges;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.catalog.ProductCatalogChanges;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.security.CryptoService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Paged administrative views. Full import staging and order customer options keep their own APIs. */
@Service
public class RosterService {
  private final JdbcTemplate jdbc;
  private final CustomerService customers;
  private final ActivityService activities;
  private final CryptoService crypto;
  public RosterService(JdbcTemplate jdbc, CustomerService customers, ActivityService activities,
      CryptoService crypto) {
    this.jdbc=jdbc; this.customers=customers; this.activities=activities; this.crypto=crypto;
  }
  public record Filters(String customerType, String branch, String status, String matchStatus, String keyword) {}
  public record Ref(long id, String revision) {}
  public record Selection(Filters filters, List<Ref> rows, String snapshot, List<Long> excludedIds) {
    public Selection(Filters filters, List<Ref> rows, String snapshot) { this(filters,rows,snapshot,null); }
  }
  public record DeletionPreview(long count, String snapshot) {}
  public record RosterPage(List<?> data, PageResponse.PageMeta page, Map<String,Long> summary,
      List<String> branches, List<String> customerTypes, Map<Long,String> revisions, String traceId) {}
  private record Query(String sql, List<Object> args) {}
  private record Stamp(long id, String revision) {}
  private static final Filters EMPTY = new Filters(null,null,null,null,null);
  private static final String ATTENDANCE_TYPE = "CASE WHEN r.participant_type LIKE '%特渠%' THEN 'SPECIAL' WHEN r.participant_type LIKE '%综合%' THEN 'GENERAL' ELSE 'ALL' END";
  private static final String ELIGIBLE = "(r.match_status='MATCHED' AND EXISTS (SELECT 1 FROM activity_customer ec JOIN activity_data_binding eb ON eb.activity_id=ec.activity_id AND eb.data_type='WHITELIST' AND eb.current_version_id=ec.data_version_id WHERE ec.id=r.activity_customer_id AND ec.activity_id=r.activity_id AND ec.is_active=TRUE))";
  private static String base(boolean whitelist) {
    return whitelist ? " FROM activity_customer r JOIN activity_data_binding b ON b.activity_id=r.activity_id AND b.data_type='WHITELIST' AND b.current_version_id=r.data_version_id WHERE r.activity_id=? AND r.is_active=TRUE"
      : " FROM activity_attendee r LEFT JOIN activity_data_binding b ON b.activity_id=r.activity_id AND b.data_type='ATTENDANCE' WHERE r.activity_id=? AND r.is_active=TRUE AND ((b.current_version_id IS NULL AND r.data_version_id IS NULL) OR r.data_version_id=b.current_version_id)";
  }
  private static String type(boolean whitelist) { return whitelist ? "r.customer_type" : ATTENDANCE_TYPE; }
  private static boolean present(String value) { return value!=null && !value.isBlank() && !value.equals("全部"); }
  private static String like(String value) { return "%"+value.replace("!","!!").replace("%","!%").replace("_","!_")+"%"; }
  private Query query(long activityId, boolean whitelist, Filters input) {
    Filters f=input==null ? EMPTY : input;
    var sql=new StringBuilder(base(whitelist)); var args=new ArrayList<Object>(); args.add(activityId);
    if(present(f.customerType())) { sql.append(" AND ").append(type(whitelist)).append("=?"); args.add(f.customerType()); }
    if(present(f.branch())) { sql.append(whitelist ? " AND r.branch_name=?" : " AND r.branch_name_snapshot=?"); args.add(f.branch()); }
    if(whitelist && present(f.status()) && !f.status().equals("有效")) sql.append(" AND 1=0");
    if(!whitelist && present(f.matchStatus())) { sql.append(" AND r.match_status=?"); args.add(f.matchStatus()); }
    if(present(f.keyword())) {
      String keyword=f.keyword().strip().toLowerCase(Locale.ROOT).replaceAll("(?U)\\s+", "");
      var fields=whitelist ? List.of("dealer_short_name","dealer_full_name","contact_name")
        : List.of("participant_name","gender","phone","phone_masked","branch_name_snapshot","dealer_name_snapshot","participant_type");
      sql.append(" AND (");
      for(int i=0;i<fields.size();i++) {
        if(i>0) sql.append(" OR ");
        sql.append("LOWER(REGEXP_REPLACE(COALESCE(r.").append(fields.get(i)).append(",''),'[[:space:]]','')) LIKE ? ESCAPE '!'");
        args.add(like(keyword));
      }
      if(whitelist) {
        String digits=CryptoService.normalizePhone(f.keyword());
        if(!digits.isEmpty()) {
          sql.append(" OR REGEXP_REPLACE(COALESCE(r.phone,''),'[^0-9]','') LIKE ? ESCAPE '!'"); args.add(like(digits));
          if(digits.matches("1\\d{10}")) { sql.append(" OR r.phone_lookup_hash=?"); args.add(crypto.lookupHash(digits)); }
          // Encrypted partial/legacy phone searches are explicit searches, never list-entry reads.
          List<Long> ids=new ArrayList<>();
          String legacy=digits.matches("1\\d{10}") ? " AND r.phone_lookup_hash IS NULL" : "";
          jdbc.query("SELECT r.id,r.phone_ciphertext"+base(true)+" AND r.phone IS NULL AND r.phone_ciphertext IS NOT NULL"+legacy,
            (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
              if(CryptoService.normalizePhone(crypto.decrypt(rs.getBytes(2))).contains(digits)) ids.add(rs.getLong(1));
            },activityId);
          if(!ids.isEmpty()) { sql.append(" OR r.id IN (").append(placeholders(ids.size())).append(")"); args.addAll(ids); }
        }
      } else {
        sql.append(" OR (CASE ").append(ATTENDANCE_TYPE).append(" WHEN 'SPECIAL' THEN '特渠专业客户' WHEN 'GENERAL' THEN '综合客户' ELSE '' END) LIKE ? ESCAPE '!'");
        args.add(like(keyword));
      }
      sql.append(")");
    }
    return new Query(sql.toString(),args);
  }
  private static String placeholders(int count) { return String.join(",",Collections.nCopies(count,"?")); }
  private static String revision(boolean whitelist) {
    // Attendance has no lock_version. Hash mutable values too: two writes can share a millisecond timestamp.
    String version=whitelist ? "r.lock_version" : "SHA2(JSON_ARRAY(r.participant_name,r.gender,r.participant_type,r.dealer_name_snapshot,r.branch_name_snapshot,r.phone,r.phone_masked,r.activity_customer_id,r.match_status,r.match_method,r.match_reason_code),256)";
    return "CONCAT(r.id,':',COALESCE(r.data_version_id,0),':',"+version+",':',r.updated_at)";
  }
  private List<Stamp> stamps(Query q, boolean whitelist, String suffix, Object... extra) {
    var args=new ArrayList<>(q.args()); args.addAll(Arrays.asList(extra));
    return jdbc.query("SELECT r.id,"+revision(whitelist)+q.sql()+suffix,
      (rs,n)->new Stamp(rs.getLong(1),rs.getString(2)),args.toArray());
  }
  @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
  public RosterPage page(long activityId, boolean whitelist, Filters filters, int page, int size, String traceId) {
    Query q=query(activityId,whitelist,filters), all=query(activityId,whitelist,EMPTY);
    long total=Objects.requireNonNullElse(jdbc.queryForObject("SELECT COUNT(*)"+q.sql(),Long.class,q.args().toArray()),0L);
    int safeSize=Math.min(100,Math.max(1,size));
    int pages=(int)Math.max(1,(total+safeSize-1)/safeSize), safePage=Math.min(Math.max(1,page),pages);
    String order=whitelist ? " ORDER BY r.excel_sequence IS NULL,r.excel_sequence,r.id" : " ORDER BY r.id DESC";
    List<Stamp> selected=stamps(q,whitelist,order+" LIMIT ? OFFSET ?",safeSize,(safePage-1L)*safeSize);
    var revisions=new LinkedHashMap<Long,String>(); selected.forEach(s->revisions.put(s.id(),s.revision()));
    List<?> rows=List.of();
    if(!selected.isEmpty()) {
      var args=new ArrayList<Object>(); args.add(activityId); args.addAll(revisions.keySet());
      String suffix=base(whitelist)+" AND r.id IN ("+placeholders(selected.size())+")"+order;
      rows=whitelist ? jdbc.query("""
          SELECT r.id,r.customer_type,r.region_code,r.branch_name,r.dealer_short_name,r.dealer_full_name,
            r.dealer_category,r.contact_name,r.phone,r.phone_ciphertext,r.phone_masked,r.confirmer_name,
            r.confirmer_phone,r.confirmer_phone_ciphertext,r.confirmer_phone_masked,r.excel_sequence,r.is_active,r.lock_version,r.updated_at
          """+suffix,customers::mapCustomer,args.toArray())
        : jdbc.query("""
          SELECT r.id,r.activity_customer_id,r.participant_name,r.gender,r.participant_type,r.dealer_name_snapshot,
            r.branch_name_snapshot,r.phone,r.phone_masked,r.match_status,r.match_method,r.match_reason_code,
            (SELECT COALESCE(c.dealer_short_name,c.dealer_full_name) FROM activity_customer c WHERE c.id=r.activity_customer_id),
          """+ELIGIBLE+",r.created_at,r.updated_at"+suffix,customers::mapAttendee,args.toArray());
    }
    Map<String,Long> summary=new LinkedHashMap<>();
    String aggregates=whitelist ? "COUNT(*) total,COUNT(*) valid,0 pending"
      : "COUNT(*) total,SUM("+type(false)+"='GENERAL') comprehensive,SUM("+type(false)+"='SPECIAL') special,SUM("+type(false)+"='ALL') blankType,SUM(COALESCE(r.phone,r.phone_masked,'')<>'') phone,SUM("+ELIGIBLE+") linked,COUNT(DISTINCT CASE WHEN "+ELIGIBLE+" THEN r.activity_customer_id END) eligible,SUM(r.match_status='PENDING_CONFIRMATION') pending,SUM(r.match_status='UNMATCHED') unmatched";
    jdbc.query("SELECT "+aggregates+all.sql(), (org.springframework.jdbc.core.RowCallbackHandler) rs->{
      var meta=rs.getMetaData(); for(int i=1;i<=meta.getColumnCount();i++) summary.put(meta.getColumnLabel(i),rs.getLong(i));
    },all.args().toArray());
    List<String> branches=whitelist ? List.of() : jdbc.queryForList("SELECT DISTINCT r.branch_name_snapshot"+all.sql()+" AND COALESCE(r.branch_name_snapshot,'')<>'' ORDER BY r.branch_name_snapshot",String.class,activityId);
    List<String> types=jdbc.queryForList("SELECT DISTINCT "+type(whitelist)+all.sql()+" ORDER BY 1",String.class,activityId);
    summary.put("published",Objects.requireNonNullElse(jdbc.queryForObject("SELECT COUNT(*) FROM activity_data_binding WHERE activity_id=? AND data_type=? AND current_version_id IS NOT NULL",Long.class,activityId,whitelist ? "WHITELIST" : "ATTENDANCE"),0L));
    return new RosterPage(rows,new PageResponse.PageMeta(safePage,safeSize,total,(int)((total+safeSize-1)/safeSize)),summary,branches,types,revisions,traceId);
  }
  private Query selection(long activityId, boolean whitelist, Selection selection) {
    if(selection==null) throw DomainException.badRequest("SELECTION_REQUIRED","请选择需要删除的记录");
    Query q=query(activityId,whitelist,selection.filters());
    if(selection.excludedIds()!=null && !selection.excludedIds().isEmpty()) {
      if(selection.excludedIds().size()>10000 || selection.excludedIds().stream().anyMatch(id->id==null || id<=0))
        throw DomainException.badRequest("SELECTION_INVALID","排除记录不正确或超过 10000 条");
      var args=new ArrayList<>(q.args()); args.addAll(selection.excludedIds());
      q=new Query(q.sql()+" AND r.id NOT IN ("+placeholders(selection.excludedIds().size())+")",args);
    }
    if(selection.rows()==null) return q;
    if(selection.rows().isEmpty() || selection.rows().size()>10000) throw DomainException.badRequest("SELECTION_INVALID","请选择 1 至 10000 条记录");
    var ids=new HashSet<Long>();
    if(selection.rows().stream().anyMatch(r->r==null || r.id()<=0 || r.revision()==null || r.revision().isBlank() || !ids.add(r.id())))
      throw DomainException.badRequest("SELECTION_INVALID","所选记录版本缺失或包含重复记录，请重新选择");
    var args=new ArrayList<>(q.args()); selection.rows().forEach(r->args.add(r.id()));
    return new Query(q.sql()+" AND r.id IN ("+placeholders(selection.rows().size())+")",args);
  }
  private DeletionPreview preview(long activityId, boolean whitelist, Selection selection, boolean lock) {
    Query q=selection(activityId,whitelist,selection);
    List<Stamp> rows=stamps(q,whitelist," ORDER BY r.id"+(lock ? " FOR UPDATE" : ""));
    if(selection.rows()!=null) {
      Map<Long,String> expected=new HashMap<>(); selection.rows().forEach(r->expected.put(r.id(),r.revision()));
      if(rows.size()!=expected.size() || rows.stream().anyMatch(r->!Objects.equals(expected.get(r.id()),r.revision())))
        throw DomainException.conflict("ROSTER_CHANGED","所选记录已变化，请刷新列表后重新选择");
    }
    try {
      var digest=MessageDigest.getInstance("SHA-256");
      digest.update((activityId+":"+whitelist+"\n").getBytes(StandardCharsets.UTF_8));
      // Include the binding even for an empty list or an import that recreates the same visible rows.
      var binding=jdbc.queryForList("SELECT current_version_id FROM activity_data_binding WHERE activity_id=? AND data_type=?",activityId,whitelist?"WHITELIST":"ATTENDANCE");
      digest.update(binding.toString().getBytes(StandardCharsets.UTF_8));
      rows.forEach(r->digest.update((r.revision()+"\n").getBytes(StandardCharsets.UTF_8)));
      return new DeletionPreview(rows.size(),HexFormat.of().formatHex(digest.digest()));
    } catch(java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }
  @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
  public DeletionPreview deletionPreview(long activityId, boolean whitelist, Selection selection) { return preview(activityId,whitelist,selection,false); }
  @Transactional
  public long delete(long activityId, boolean whitelist, Selection selection) {
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE",activityId);
    String status=activities.byId(activityId).status();
    if(List.of("CLOSED","FINISHED","ARCHIVED").contains(status) || whitelist && !"DRAFT".equals(status))
      throw DomainException.conflict("ACTIVITY_READ_ONLY","当前活动状态禁止删除名单");
    DeletionPreview current=preview(activityId,whitelist,selection,true);
    if(!Objects.equals(current.snapshot(),selection.snapshot())) throw DomainException.conflict("ROSTER_CHANGED","名单已变化，请重新确认删除范围");
    if(current.count()==0) return 0;
    Query q=selection(activityId,whitelist,selection);
    // Reuse the exact checked predicate. Selected rows and the activity remain locked until commit.
    String from=q.sql().substring(q.sql().indexOf(" FROM ")+6);
    String set=whitelist ? "r.is_active=FALSE,r.deactivated_at=UTC_TIMESTAMP(3),r.lock_version=r.lock_version+1" : "r.is_active=FALSE,r.updated_at=UTC_TIMESTAMP(3)";
    int where=from.indexOf(" WHERE ");
    if(whitelist) {
      String join=from.substring(0,where).replace("activity_customer r JOIN", "activity_customer r ON s.activity_customer_id=r.id JOIN");
      jdbc.update("UPDATE h5_session s JOIN "+join+" SET s.revoked_at=UTC_TIMESTAMP(3)"+from.substring(where)+" AND s.revoked_at IS NULL",q.args().toArray());
    }
    int changed=jdbc.update("UPDATE "+from.substring(0,where)+" SET "+set+from.substring(where),q.args().toArray());
    if(changed!=current.count()) throw DomainException.conflict("ROSTER_CHANGED","名单已变化，本次删除已取消");
    if(whitelist) {
      customers.reassociateAttendance(activityId);
      ActivityInfoChanges.record(jdbc,activityId); ProductCatalogChanges.all(jdbc,activityId);
    }
    return changed;
  }
}
