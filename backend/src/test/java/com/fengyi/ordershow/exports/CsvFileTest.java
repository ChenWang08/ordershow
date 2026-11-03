package com.fengyi.ordershow.exports;

import static org.assertj.core.api.Assertions.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CsvFileTest {
  @TempDir Path directory;
  @Test void bomQuotesNewlinesFormulaProtectionAndExactDecimals()throws Exception {
    Path path=directory.resolve("test.csv");
    try(var csv=new CsvFile(path,10000,"字段","数值")) {
      csv.row("经销商,\"名称\"\r\n第二行",new BigDecimal("123456789012345.6789"));
      csv.row("  =SUM(1,2)",new BigDecimal("-2.50"));
      csv.row("\t危险","001234567890123456789");
      csv.row(null,"@命令");
    }
    byte[] bytes=Files.readAllBytes(path);
    assertThat(bytes).startsWith((byte)0xef,(byte)0xbb,(byte)0xbf);
    assertThat(new String(bytes,StandardCharsets.UTF_8)).isEqualTo("\ufeff\"字段\",\"数值\"\r\n"
        +"\"经销商,\"\"名称\"\"\r\n第二行\",\"123456789012345.6789\"\r\n"
        +"\"'  =SUM(1,2)\",\"-2.50\"\r\n\"'\t危险\",\"001234567890123456789\"\r\n\"\",\"'@命令\"\r\n");
  }
  @Test void sharedBudgetBoundsAllSourceFiles()throws Exception {
    var budget=new ExportByteBudget(32);
    try(var first=new CsvFile(directory.resolve("1.csv"),budget,"a")) {first.row("12345");}
    try(var second=new CsvFile(directory.resolve("2.csv"),budget,"b")) {
      assertThatThrownBy(()->second.row("1234567890123456789")).isInstanceOf(java.io.IOException.class).hasMessage("EXPORT_TEMP_LIMIT");
    }
  }
  @Test void detailHeadersMatchAgreedSeventeenColumns() {
    assertThat(CsvExportGenerator.NAMES).containsExactly("订单汇总.csv","订单商品明细.csv","有效商品汇总.csv","有效分公司汇总.csv");
    assertThat(CsvExportGenerator.HEADERS[1]).containsExactly("订单编号","状态","来源","客户类型","大区","分公司","经销商","电话","订单版本","行号","物料代码","物料名称","项目组","订货箱数","金额","吨数","最后提交（北京时间）");
    assertThat(java.util.Arrays.stream(CsvExportGenerator.HEADERS).mapToInt(h->h.length).toArray()).containsExactly(15,17,9,6);
  }
}
