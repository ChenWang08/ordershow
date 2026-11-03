package com.fengyi.ordershow.exports;

import java.io.BufferedWriter;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** RFC 4180 records, UTF-8 BOM, and formula protection only for text fields. */
final class CsvFile implements AutoCloseable {
  private final BufferedWriter out;
  private final ExportByteBudget budget;
  CsvFile(Path path,long limit,String... headers)throws IOException {
    this(path,new ExportByteBudget(limit),headers);
  }
  CsvFile(Path path,ExportByteBudget budget,String... headers)throws IOException {
    this.budget=budget;budget.reserve(3);
    out=Files.newBufferedWriter(path,StandardCharsets.UTF_8);
    try {out.write('\ufeff');row((Object[])headers);}catch(IOException error){out.close();throw error;}
  }
  void row(Object... values)throws IOException {
    var record=new StringBuilder();
    for(int i=0;i<values.length;i++) {
      if(i>0)record.append(',');
      Object value=values[i];
      String text=value==null?"":value instanceof BigDecimal number?number.toPlainString():value.toString();
      if(value instanceof String && !text.isEmpty()) {
        String leading=text.stripLeading();
        if((!leading.isEmpty() && "=+-@".indexOf(leading.charAt(0))>=0) || "\t\r\n".indexOf(text.charAt(0))>=0) text="'"+text;
      }
      record.append('"').append(text.replace("\"","\"\"")).append('"');
    }
    record.append("\r\n"); String line=record.toString(); budget.reserve(line.getBytes(StandardCharsets.UTF_8).length);
    out.write(line);
  }
  @Override public void close()throws IOException{out.close();}
}
