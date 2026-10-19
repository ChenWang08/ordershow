package com.fengyi.ordershow.common;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** DATETIME has no timezone. All new database values represent UTC wall time. */
public final class UtcTime {
  private static final DateTimeFormatter BEIJING = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
      .withZone(ZoneId.of("Asia/Shanghai"));

  private UtcTime() {}

  public static LocalDateTime database(Instant value) {
    return value == null ? null : LocalDateTime.ofInstant(value, ZoneOffset.UTC);
  }

  public static Instant read(ResultSet rs, String column) throws SQLException {
    return instant(rs.getObject(column, LocalDateTime.class));
  }

  public static Instant read(ResultSet rs, int column) throws SQLException {
    return instant(rs.getObject(column, LocalDateTime.class));
  }

  public static Instant instant(Object value) {
    if (value == null) return null;
    if (value instanceof Instant instant) return instant;
    if (value instanceof LocalDateTime time) return time.toInstant(ZoneOffset.UTC);
    if (value instanceof Timestamp time) return time.toInstant();
    if (value instanceof OffsetDateTime time) return time.toInstant();
    throw new IllegalArgumentException("Unsupported database timestamp: " + value.getClass().getName());
  }

  public static String beijing(Object value) {
    return value == null ? "" : BEIJING.format(instant(value));
  }
}
