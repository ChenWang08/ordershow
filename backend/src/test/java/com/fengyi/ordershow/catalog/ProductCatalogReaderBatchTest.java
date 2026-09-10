package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.AdditionalMatchers.aryEq;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.catalog.ProductService.ProductView;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.List;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

class ProductCatalogReaderBatchTest {
  @Test
  void h5CatalogJoinsCurrentBindingAndRetainsScopeWithoutSeparateVersionLookup() {
    var jdbc = mock(JdbcTemplate.class);
    var activities = mock(ActivityService.class);
    when(activities.orderingActivity("A")).thenReturn(new ActivityService.OrderingActivity(3,java.time.Instant.MAX));
    var customer = new com.fengyi.ordershow.security.H5Principal(1,3,4,"A","SPECIAL",null,"上海分",null,null,null);
    assertThat(new ProductCatalogReader(jdbc,activities).h5Products("A",customer,null,null)).isEmpty();
    verify(jdbc).query(argThat((String sql) -> sql.contains("b.current_version_id = p.data_version_id")
        && sql.contains("p.activity_id = ?") && sql.contains("p.customer_type = ?") && sql.contains("s.normalized_branch_name = ?")),
        any(org.springframework.jdbc.core.RowMapper.class), aryEq(new Object[]{3L,"SPECIAL","SPECIAL",null,null,null,null,null,null,null,"上海分"}));
    verifyNoMoreInteractions(jdbc);
    var wrong = new com.fengyi.ordershow.security.H5Principal(1,9,4,"B","SPECIAL",null,null,null,null,null);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> new ProductCatalogReader(jdbc,activities).h5Products("A",wrong,null,null))
        .isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
    verifyNoMoreInteractions(jdbc);
  }

  @Test
  void batchesThreeRelationsWithoutChangingOrderOrMixingProductIds() throws Exception {
    JdbcTemplate jdbc=mock(JdbcTemplate.class);
    ProductCatalogReader reader=new ProductCatalogReader(jdbc,mock(ActivityService.class));
    doAnswer(call -> {
      String sql=call.getArgument(0); RowCallbackHandler callback=call.getArgument(1);
      ResultSet row=mock(ResultSet.class); when(row.getLong(1)).thenReturn(11L);
      if(sql.contains("product_image")) {
        when(row.getLong(2)).thenReturn(72L);when(row.getLong(3)).thenReturn(99L);
        when(row.getBoolean(4)).thenReturn(true); callback.processRow(row);
      } else if(sql.contains("branch_scope")) {
        when(row.getString(2)).thenReturn("上海分");callback.processRow(row);
      } else {
        when(row.getLong(2)).thenReturn(20L);when(row.getBigDecimal(3)).thenReturn(new BigDecimal("80"));
        when(row.getString(4)).thenReturn("WHOLE_ORDER");callback.processRow(row);
      }
      return null;
    }).when(jdbc).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
    ProductView first=mock(ProductView.class), second=mock(ProductView.class);
    when(first.id()).thenReturn(29L);when(second.id()).thenReturn(11L);
    var values=reader.withDetails(List.of(first,second));
    assertThat(values).extracting(ProductView::id).containsExactly(29L,11L);
    assertThat(values.getFirst().images()).isEmpty();assertThat(values.getFirst().branchScope()).isEmpty();
    assertThat(values.getFirst().priceTier()).isNull();
    assertThat(values.get(1).images().getFirst().url()).isEqualTo("/api/v1/public/files/99");
    assertThat(values.get(1).images().getFirst().primary()).isTrue();
    assertThat(values.get(1).branchScope()).containsExactly("上海分");
    assertThat(values.get(1).priceTier().casePrice()).isEqualByComparingTo("80");
    verify(jdbc,times(3)).query(anyString(),any(RowCallbackHandler.class),aryEq(new Object[]{29L,11L}));
  }

  @Test
  void boundsBatchesAndDoesNotQueryEmptyCatalog() {
    JdbcTemplate jdbc=mock(JdbcTemplate.class);
    ProductCatalogReader reader=new ProductCatalogReader(jdbc,mock(ActivityService.class));
    assertThat(reader.withDetails(List.of())).isEmpty();verifyNoInteractions(jdbc);
    var rows=LongStream.rangeClosed(1,501).mapToObj(id->{ProductView p=mock(ProductView.class);when(p.id()).thenReturn(id);return p;}).toList();
    assertThat(reader.withDetails(rows)).hasSize(501);
    verify(jdbc,times(6)).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
  }
}
