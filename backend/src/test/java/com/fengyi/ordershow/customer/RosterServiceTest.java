package com.fengyi.ordershow.customer;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class RosterServiceTest {
  @Test void batchDeletionHonorsEachModulesActivityRestrictions() {
    for(boolean whitelist : List.of(true,false)) {
      for(String status : whitelist ? List.of("SCHEDULED","ACTIVE","CLOSED","FINISHED","ARCHIVED") : List.of("CLOSED","FINISHED","ARCHIVED")) {
        var jdbc=mock(JdbcTemplate.class);
        var activities=mock(ActivityService.class);
        var activity=mock(ActivityService.ActivityView.class);
        when(activities.byId(17L)).thenReturn(activity); when(activity.status()).thenReturn(status);
        var service=new RosterService(jdbc,mock(CustomerService.class),activities,mock(CryptoService.class));
        assertThatThrownBy(()->service.delete(17L,whitelist,new RosterService.Selection(null,null,"old")))
          .isInstanceOfSatisfying(DomainException.class,error->assertThat(error.code()).isEqualTo("ACTIVITY_READ_ONLY"));
        verify(jdbc,never()).update(anyString(),any(Object[].class));
      }
    }
  }
  @Test void mismatchedConfirmationNeverChangesRecordsEvenForAnEmptySelection() {
    var jdbc=mock(JdbcTemplate.class); var activities=mock(ActivityService.class);
    var activity=mock(ActivityService.ActivityView.class);
    when(activities.byId(17L)).thenReturn(activity); when(activity.status()).thenReturn("DRAFT");
    var service=new RosterService(jdbc,mock(CustomerService.class),activities,mock(CryptoService.class));
    assertThatThrownBy(()->service.delete(17L,true,new RosterService.Selection(null,null,"not-the-confirmed-snapshot")))
      .isInstanceOfSatisfying(DomainException.class,error->assertThat(error.code()).isEqualTo("ROSTER_CHANGED"));
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }
  @Test void anEmptyExplicitSelectionCannotBecomeAnUnfilteredClearAll() {
    var service=new RosterService(mock(JdbcTemplate.class),mock(CustomerService.class),mock(ActivityService.class),mock(CryptoService.class));
    assertThatThrownBy(()->service.deletionPreview(17L,true,new RosterService.Selection(null,List.of(),null)))
      .isInstanceOfSatisfying(DomainException.class,error->assertThat(error.code()).isEqualTo("SELECTION_INVALID"));
  }
}
