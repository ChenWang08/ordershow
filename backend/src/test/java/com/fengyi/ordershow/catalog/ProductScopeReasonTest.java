package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.order.PriceSyncService;
import com.fengyi.ordershow.order.TonnageSyncService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ProductScopeReasonTest {
  @Test void activeScopeChangesRequireReasonEvenForDirectApiCalls() throws Exception {
    var jdbc=mock(JdbcTemplate.class);
    var activities=mock(ActivityService.class);
    var activity=mock(ActivityService.ActivityView.class);
    when(activity.status()).thenReturn("ACTIVE"); when(activities.byId(10)).thenReturn(activity);
    var catalog=mock(ProductCatalogReader.class);
    when(catalog.product(10,11)).thenReturn(mock(ProductService.ProductView.class));
    var service=new ProductService(jdbc,activities,catalog,mock(ProductImageService.class),mock(PriceSyncService.class),mock(TonnageSyncService.class));
    for(String body:new String[]{"{\"branchScope\":\"上海分\"}","{\"dealerScope\":[]}","{\"customerType\":\"ALL\"}"}) {
      var patch=new ObjectMapper().readValue(body,ProductService.ProductPatch.class);
      assertThatThrownBy(() -> service.update(10,11,0,patch)).isInstanceOf(DomainException.class)
          .satisfies(error -> assertThat(((DomainException)error).code()).isEqualTo("PRODUCT_EDIT_REASON_REQUIRED"));
    }
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }
}
