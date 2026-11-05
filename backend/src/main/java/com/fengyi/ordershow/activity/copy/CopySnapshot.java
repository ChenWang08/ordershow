package com.fengyi.ordershow.activity.copy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import java.util.*;
import org.springframework.jdbc.core.ColumnMapRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;

/** Only configuration columns are captured. No order/statistics/candidate queries belong here. */
public final class CopySnapshot {
  public static final String PRODUCTS="customer_type,rebate_status,business_key,material_code,material_name,description,category_name,product_line,brand_name,variety_name,specification,case_pack,bottle_price,case_price,ton_case_factor,is_gift_box,is_branch_customized,is_visible,is_orderable,sort_no,data_status";
  public static final String CUSTOMERS="customer_id,customer_type,region_code,branch_name,normalized_branch_name,dealer_short_name,dealer_full_name,normalized_dealer_full_name,dealer_category,contact_name,phone,phone_ciphertext,phone_lookup_hash,phone_masked,phone_key_version,confirmer_name,confirmer_phone,confirmer_phone_ciphertext,confirmer_phone_masked,excel_sequence,is_active";
  public static final String ROUNDS="round_no,name,prize_name,prize_image_file_id,winner_count,candidate_scope,customer_type,minimum_order_amount,qualification_metric,probability_mode,minimum_order_box_count,minimum_order_tons,product_line,product_line_unassigned,varieties_json,include_unspecified_variety,exclude_previous_winners,display_name_type";
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private long bytes;
  private int count;
  private final int maxRows,maxBytes;
  public CopySnapshot(JdbcTemplate jdbc,ObjectMapper json,int maxRows,int maxBytes){this.jdbc=jdbc;this.json=json;this.maxRows=maxRows;this.maxBytes=maxBytes;}
  public record Selection(boolean products,boolean whitelist,boolean lottery){public boolean any(){return products||whitelist||lottery;}}
  public record Data(Map<String,List<Map<String,Object>>> tables,Selection selection){}
  public Data capture(long source,Long productVersion,Long whitelistVersion,Long ruleId,Selection selected){
    var tables=new LinkedHashMap<String,List<Map<String,Object>>>();
    if(selected.products()){
      String predicate="p.activity_id=? AND p.data_version_id=? AND p.data_status<>'INACTIVE' AND p.deactivated_at IS NULL";
      tables.put("products",read("SELECT p.id,"+prefix(PRODUCTS,"p")+" FROM activity_product p WHERE "+predicate+" ORDER BY p.id",source,productVersion));
      var children=Map.of("tiers",new String[]{"activity_product_price_tier","activity_product_id,min_quantity,case_price,pricing_mode"},
          "branches",new String[]{"activity_product_branch_scope","activity_product_id,branch_name,normalized_branch_name"},
          "dealerScopes",new String[]{"activity_product_dealer_scope","activity_product_id,normalized_branch_name,branch_name"},
          "dealerMembers",new String[]{"activity_product_dealer_member","activity_product_id,normalized_branch_name,customer_id,customer_type,normalized_dealer_full_name,dealer_full_name"},
          "images",new String[]{"product_image","activity_product_id,stored_file_id,is_primary,sort_no,source_type,match_status"});
      children.forEach((key,spec)->tables.put(key,read("SELECT "+prefix(spec[1],"c")+" FROM "+spec[0]+" c JOIN activity_product p ON p.id=c.activity_product_id WHERE "+predicate+(key.equals("images")?" AND c.deleted_at IS NULL":"")+" ORDER BY c.activity_product_id",source,productVersion)));
    }
    if(selected.whitelist()){
      tables.put("customers",read("SELECT id,"+CUSTOMERS+" FROM activity_customer WHERE activity_id=? AND data_version_id=? AND is_active=TRUE ORDER BY id",source,whitelistVersion));
      tables.put("regions",read("SELECT region_code,region_name,sort_no,is_active FROM activity_region WHERE activity_id=? AND is_active=TRUE ORDER BY id",source));
    }
    if(selected.lottery()){
      tables.put("rule",read("SELECT name FROM lottery_rule WHERE id=? AND activity_id=?",ruleId,source));
      tables.put("rounds",read("SELECT "+ROUNDS+" FROM lottery_round WHERE lottery_rule_id=? AND activity_id=? ORDER BY round_no,id",ruleId,source));
    }
    var files=new LinkedHashSet<Long>();
    tables.getOrDefault("images",List.of()).forEach(r->files.add(number(r.get("stored_file_id"))));
    tables.getOrDefault("rounds",List.of()).forEach(r->{if(r.get("prize_image_file_id")!=null)files.add(number(r.get("prize_image_file_id")));});
    var metadata=new ArrayList<Map<String,Object>>();var ids=new ArrayList<>(files);
    for(int start=0;start<ids.size();start+=200){
      var batch=ids.subList(start,Math.min(ids.size(),start+200));var args=new ArrayList<Object>(batch);args.add(source);
      metadata.addAll(read("SELECT id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose FROM stored_file WHERE id IN ("+String.join(",",Collections.nCopies(batch.size(),"?"))+") AND activity_id=? AND deleted_at IS NULL",args.toArray()));
    }
    if(metadata.size()!=files.size())throw DomainException.conflict("COPY_IMAGE_CHANGED","来源图片已变化，请重新选择来源活动");
    tables.put("files",metadata);return new Data(tables,selected);
  }
  private List<Map<String,Object>> read(String sql,Object...args){
    return jdbc.query(sql,rs->{
      var rows=new ArrayList<Map<String,Object>>();var mapper=new ColumnMapRowMapper();
      while(rs.next()){
        if(++count>maxRows)throw tooLarge();
        var row=new LinkedHashMap<String,Object>();
        mapper.mapRow(rs,count).forEach((key,value)->row.put(key.toLowerCase(Locale.ROOT),value instanceof byte[] raw?HexFormat.of().formatHex(raw):value));
        try{bytes+=json.writeValueAsBytes(row).length;}catch(Exception e){throw new IllegalStateException(e);}
        if(bytes>maxBytes)throw tooLarge();rows.add(row);
      }return rows;
    },args);
  }
  private static DomainException tooLarge(){return DomainException.badRequest("COPY_SIZE_LIMIT","本次配置超过单次复用上限，请减少复制项目或使用导入功能");}
  public static String prefix(String columns,String alias){return Arrays.stream(columns.split(",")).map(c->alias+"."+c).collect(java.util.stream.Collectors.joining(","));}
  public static long number(Object value){return ((Number)value).longValue();}
}
