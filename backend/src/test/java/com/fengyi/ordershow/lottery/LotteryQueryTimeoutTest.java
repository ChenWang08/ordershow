package com.fengyi.ordershow.lottery;

import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.storage.StorageService;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;

class LotteryQueryTimeoutTest {
  @SuppressWarnings("unchecked")
  @Test void bothHeavyReadPathsSetStatementTimeoutWithoutChangingSharedJdbcSettings() throws Exception {
    var jdbc=mock(JdbcTemplate.class);var connection=mock(Connection.class);var statement=mock(PreparedStatement.class);
    when(connection.prepareStatement(anyString())).thenReturn(statement);
    when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
      call.<PreparedStatementCreator>getArgument(0).createPreparedStatement(connection);return List.of();
    });
    var service=new LotteryService(jdbc,mock(StringRedisTemplate.class),new ObjectMapper(),mock(ActivityService.class),mock(StorageService.class));
    service.productOptions(1);
    service.preview(1,new LotteryService.PreviewRequest(1,10,"VALID_ORDERS","ALL",BigDecimal.ZERO,"TONS","EQUAL",0,false,BigDecimal.ZERO,null,List.of(),false,false));
    verify(statement,times(2)).setQueryTimeout(8);
    verify(jdbc,never()).setQueryTimeout(anyInt());
  }
}
