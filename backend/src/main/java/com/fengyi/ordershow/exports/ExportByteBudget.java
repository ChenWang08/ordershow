package com.fengyi.ordershow.exports;

import java.io.IOException;

/** Shared by the four source CSVs and their ZIP, which coexist until upload completes. */
final class ExportByteBudget {
  private final long limit;
  private long used;
  ExportByteBudget(long limit) { this.limit=limit; }
  void reserve(long bytes)throws IOException {
    if(bytes<0 || bytes>limit-used)throw new IOException("EXPORT_TEMP_LIMIT");
    used+=bytes;
  }
}
