package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.order.OrderQueryService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** The read snapshot ends before compression/upload. At most one bounded batch is materialized. */
public class CsvExportGenerator {
  public static final String[] NAMES={"订单汇总.csv","订单商品明细.csv","有效商品汇总.csv","有效分公司汇总.csv"};
  public static final String[][] HEADERS={
    {"订单编号","状态","来源","客户类型","大区","分公司","经销商","电话","版本","订货箱数","订货吨数","订单金额","首次提交（北京时间）","最后提交（北京时间）","最后修改（北京时间）"},
    {"订单编号","状态","来源","客户类型","大区","分公司","经销商","电话","订单版本","行号","物料代码","物料名称","项目组","订货箱数","金额","吨数","最后提交（北京时间）"},
    {"物料代码","物料名称","项目组","规格","箱规","订货箱数","订货金额","订货吨数","下单客户数"},
    {"大区","分公司","有效订单数","订货箱数","订货吨数","订单金额"}
  };
  @FunctionalInterface public interface Progress { void update(String stage,long orders,long details); }
  private final JdbcTemplate jdbc;
  private final OrderQueryService filters;
  private final TransactionTemplate read;
  private final int batch;
  private final long limit;
  public CsvExportGenerator(JdbcTemplate jdbc,PlatformTransactionManager manager,OrderQueryService filters,int batch,int seconds,long limit) {
    this.jdbc=jdbc; this.filters=filters; this.batch=Math.clamp(batch,1,2000); this.limit=Math.clamp(limit,1L,10737418240L);
    read=new TransactionTemplate(manager);read.setReadOnly(true);read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);read.setTimeout(Math.clamp(seconds,1,300));
  }
  public Result generate(Task task,Path directory,Progress progress)throws IOException {
    Files.createDirectories(directory);
    var budget=new ExportByteBudget(limit);
    List<Long> counts=new ArrayList<>(List.of(0L,0L,0L,0L));
    Instant[] snapshot={null};
    try {
      read.executeWithoutResult(s -> {
        // Establish the database snapshot, not a browser time or the time the task was queued.
        snapshot[0]=jdbc.queryForObject("SELECT UTC_TIMESTAMP(3) FROM activity WHERE id=?",(r,n)->UtcTime.read(r,1),task.activityId());
        try {
          summary(task,directory,counts,progress,budget); details(task,directory,counts,progress,budget);
          totals(task,directory,counts,progress,budget);
        }catch(IOException error){throw new java.io.UncheckedIOException(error);}
      });
    }catch(java.io.UncheckedIOException error){throw error.getCause();}
    progress.update("COMPRESSING",counts.get(0),counts.get(1));
    Path zip=directory.resolve("orders.zip");
    try(var file=Files.newOutputStream(zip);var output=new ZipOutputStream(new java.io.FilterOutputStream(file) {
      @Override public void write(int b)throws IOException {budget.reserve(1);out.write(b);}
      @Override public void write(byte[] b,int offset,int length)throws IOException {budget.reserve(length);out.write(b,offset,length);}
    })) {
      output.setLevel(1); byte[] buffer=new byte[64*1024];
      for(String name:NAMES) {
        output.putNextEntry(new ZipEntry(name));
        try(var input=Files.newInputStream(directory.resolve(name))) {
          int length;long checked=0;
          while((length=input.read(buffer))!=-1) {
            output.write(buffer,0,length);checked+=length;
            if(checked>=4*1024*1024){progress.update("COMPRESSING",counts.get(0),counts.get(1));checked=0;}
          }
        }
        output.closeEntry();
      }
    }
    return new Result(zip,snapshot[0],List.copyOf(counts));
  }
  private Object[] args(Task task,boolean effective,Object... cursor) {
    var f=task.filters();
    var result=new ArrayList<>(Arrays.asList(filters.orderFilterArgs(task.activityId(),effective?"SUBMITTED":f.status(),f.customerType(),f.keyword())));
    result.addAll(Arrays.asList(cursor));return result.toArray();
  }
  private void summary(Task task,Path dir,List<Long> counts,Progress progress,ExportByteBudget budget)throws IOException {
    long cursor=0;
    try(var csv=new CsvFile(dir.resolve(NAMES[0]),budget,HEADERS[0])) {
      while(true) {
        var rows=jdbc.queryForList("SELECT o.*,c.phone FROM customer_order o JOIN activity_customer c ON c.id=o.activity_customer_id"+OrderQueryService.orderFilterSql()+" AND o.id>? ORDER BY o.id LIMIT ?",args(task,false,cursor,batch));
        for(var r:rows) {
          csv.row(r.get("order_no"),r.get("status"),source(r.get("created_source")),r.get("customer_type"),r.get("region_code"),r.get("branch_name_snapshot"),r.get("dealer_full_name_snapshot"),r.get("phone"),r.get("current_version_no"),r.get("total_quantity"),r.get("total_tons"),r.get("total_amount"),UtcTime.beijing(r.get("first_submitted_at")),UtcTime.beijing(r.get("last_submitted_at")),UtcTime.beijing(r.get("last_modified_at")));
          cursor=((Number)r.get("id")).longValue();counts.set(0,counts.get(0)+1);
        }
        progress.update("READING",counts.get(0),counts.get(1));
        if(rows.size()<batch)break;
      }
    }
  }
  private void details(Task task,Path dir,List<Long> counts,Progress progress,ExportByteBudget budget)throws IOException {
    long cursor=0;
    try(var csv=new CsvFile(dir.resolve(NAMES[1]),budget,HEADERS[1])) {
      while(true) {
        int orderBatch=Math.min(batch,200);
        var orders=jdbc.queryForList("SELECT o.*,c.phone FROM customer_order o JOIN activity_customer c ON c.id=o.activity_customer_id"
            +OrderQueryService.orderFilterSql()+" AND o.id>? ORDER BY o.id LIMIT ?",args(task,false,cursor,orderBatch));
        if(orders.isEmpty())break;
        var byId=new java.util.LinkedHashMap<Long,Map<String,Object>>();
        for(var row:orders)byId.put(((Number)row.get("id")).longValue(),row);
        String placeholders=String.join(",",java.util.Collections.nCopies(byId.size(),"?"));
        long order=cursor,line=0;
        while(true) {
          var parameters=new ArrayList<Object>(byId.keySet());
          parameters.add(order);parameters.add(order);parameters.add(line);parameters.add(batch);
          // Keep sorting and range access entirely on uk_order_item_line. Joining all items and sorting
          // across o.id/i.line_no would rescan the remaining event on every page in MySQL.
          var rows=jdbc.queryForList("""
              SELECT order_id,line_no,material_code,material_name,product_line,quantity,line_amount,line_tons
              FROM order_item WHERE order_id IN (
              """+placeholders+") AND (order_id>? OR (order_id=? AND line_no>?)) ORDER BY order_id,line_no LIMIT ?",parameters.toArray());
          for(var item:rows) {
            order=((Number)item.get("order_id")).longValue();line=((Number)item.get("line_no")).longValue();
            var r=byId.get(order);
            csv.row(r.get("order_no"),r.get("status"),source(r.get("created_source")),r.get("customer_type"),r.get("region_code"),r.get("branch_name_snapshot"),r.get("dealer_full_name_snapshot"),r.get("phone"),r.get("current_version_no"),item.get("line_no"),item.get("material_code"),item.get("material_name"),item.get("product_line"),item.get("quantity"),item.get("line_amount"),item.get("line_tons"),UtcTime.beijing(r.get("last_submitted_at")));
            counts.set(1,counts.get(1)+1);
          }
          progress.update("READING",counts.get(0),counts.get(1));
          if(rows.size()<batch)break;
        }
        cursor=((Number)orders.getLast().get("id")).longValue();
        if(orders.size()<orderBatch)break;
      }
    }
  }
  private void totals(Task task,Path dir,List<Long> counts,Progress progress,ExportByteBudget budget)throws IOException {
    String product="""
        SELECT i.material_code,i.material_name,i.product_line,i.specification,i.case_pack,SUM(i.quantity),SUM(i.line_amount),
          COALESCE(SUM(i.line_tons),0),COUNT(DISTINCT o.id)
        FROM customer_order o JOIN activity_customer c ON c.id=o.activity_customer_id JOIN order_item i ON i.order_id=o.id
        """+OrderQueryService.orderFilterSql()+" GROUP BY i.material_code,i.material_name,i.product_line,i.specification,i.case_pack ORDER BY i.product_line,i.material_code";
    String branch="""
        SELECT o.region_code,o.branch_name_snapshot,COUNT(*),SUM(o.total_quantity),COALESCE(SUM(o.total_tons),0),SUM(o.total_amount)
        FROM customer_order o JOIN activity_customer c ON c.id=o.activity_customer_id
        """+OrderQueryService.orderFilterSql()+" GROUP BY o.region_code,o.branch_name_snapshot ORDER BY o.region_code,o.branch_name_snapshot";
    for(int index=2;index<4;index++) {
      final int sheet=index;
      // MySQL cursor reads aggregate results incrementally, including unusually many distinct SKUs.
      int old=jdbc.getFetchSize();jdbc.setFetchSize(Integer.MIN_VALUE);
      try(var csv=new CsvFile(dir.resolve(NAMES[sheet]),budget,HEADERS[sheet])) {
        jdbc.query(index==2?product:branch,(RowCallbackHandler)r->{
          Object[] values=new Object[HEADERS[sheet].length];for(int c=0;c<values.length;c++)values[c]=r.getObject(c+1);
          try{csv.row(values);}catch(IOException error){throw new java.io.UncheckedIOException(error);}
          counts.set(sheet,counts.get(sheet)+1);
          if(counts.get(sheet)%batch==0)progress.update("READING",counts.get(0),counts.get(1));
        },args(task,true));
      }finally{jdbc.setFetchSize(old);}
      progress.update("READING",counts.get(0),counts.get(1));
    }
  }
  private static String source(Object value){return "ADMIN".equals(value)?"管理员":"客户";}
}
