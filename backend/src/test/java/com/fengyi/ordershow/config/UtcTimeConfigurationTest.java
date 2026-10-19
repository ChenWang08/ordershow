package com.fengyi.ordershow.config;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fengyi.ordershow.common.UtcTime;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

class UtcTimeConfigurationTest {
  @Test
  void mapQueriesAndTypedQueriesExposeTheSameInstantInEveryJvmZone() throws Exception {
    var original = TimeZone.getDefault();
    try {
      for (String zone : new String[]{"UTC", "Asia/Shanghai", "America/Los_Angeles"}) {
        TimeZone.setDefault(TimeZone.getTimeZone(zone));
        var utc = LocalDateTime.parse("2026-10-19T05:41:03.123");
        var row = mock(ResultSet.class);
        when(row.getObject("requested_at", LocalDateTime.class)).thenReturn(utc);
        when(row.getObject(1, LocalDateTime.class)).thenReturn(utc);
        var instant = Instant.parse("2026-10-19T05:41:03.123Z");
        assertThat(UtcTime.read(row, "requested_at")).isEqualTo(instant);
        assertThat(UtcTime.read(row, 1)).isEqualTo(instant);
        assertThat(UtcTime.database(instant)).isEqualTo(utc);
        assertThat(UtcTime.read(row, "reviewed_at")).isNull();
        var builder = Jackson2ObjectMapperBuilder.json().featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        new UtcTimeConfiguration().utcDatabaseTimes().customize(builder);
        var json = builder.build();
        assertThat(json.writeValueAsString(Map.of("requestedAt", utc)))
            .isEqualTo(json.writeValueAsString(Map.of("requestedAt", instant)));
        assertThat(json.writeValueAsString(Map.of("requestedAt", utc))).contains("05:41:03.123Z");
        assertThat(UtcTime.beijing(utc)).isEqualTo("2026-10-19 13:41:03");
        assertThat(UtcTime.beijing(Instant.parse("2026-12-31T16:00:00Z"))).isEqualTo("2027-01-01 00:00:00");
        assertThat(UtcTime.beijing(null)).isEmpty();
      }
    } finally { TimeZone.setDefault(original); }
  }
}
