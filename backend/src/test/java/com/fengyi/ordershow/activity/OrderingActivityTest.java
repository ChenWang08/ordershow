package com.fengyi.ordershow.activity;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.common.DomainException;
import java.sql.ResultSet;
import java.time.LocalDateTime;
import com.fengyi.ordershow.common.UtcTime;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class OrderingActivityTest {
  @ParameterizedTest
  @CsvSource({"ACTIVE,60,true","SCHEDULED,60,true","ACTIVE,0,false","SCHEDULED,0,false","CLOSED,60,false","DRAFT,60,false","FINISHED,60,false","ARCHIVED,60,false"})
  void lightweightGuardPreservesStatusAndExactDeadline(String status,int remainingSeconds,boolean writable) throws Exception {
    var now=Instant.parse("2026-09-08T00:00:00Z");
    JdbcTemplate jdbc=mock(JdbcTemplate.class);ResultSet row=mock(ResultSet.class);
    when(row.getString("status")).thenReturn(status);
    when(row.getObject("starts_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.minusSeconds(60)));
    when(row.getObject("ends_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.plusSeconds(remainingSeconds)));
    when(row.getObject("event_ends_at", LocalDateTime.class)).thenReturn(UtcTime.database(now.plusSeconds(3600)));
    doAnswer(call->List.of(((RowMapper<?>)call.getArgument(1)).mapRow(row,0)))
        .when(jdbc).query(anyString(),any(RowMapper.class),any(Object[].class));
    var service=new ActivityService(jdbc,Clock.fixed(now,ZoneOffset.UTC));
    if(writable) assertDoesNotThrow(()->service.requireWritable(7));
    else assertThrows(DomainException.class,()->service.requireWritable(7));
    verify(jdbc,times(1)).query(anyString(),any(RowMapper.class),any(Object[].class));
    verifyNoMoreInteractions(jdbc);
  }
}
