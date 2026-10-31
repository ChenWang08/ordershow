package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.catalog.H5CatalogDataService.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.*;
import org.junit.jupiter.api.Test;

class H5CatalogServiceTest {
  final H5CatalogDataService data=mock(H5CatalogDataService.class);
  final H5CatalogCache cache=mock(H5CatalogCache.class);
  final H5Principal identity=new H5Principal(1,2,3,"A","GENERAL",null,"old",null,"old",null);
  H5CatalogService service(boolean enabled) { return new H5CatalogService(data,cache,new SimpleMeterRegistry(),enabled); }
  Context context(long revision,String branch) { return new Context(2,revision,99,3,4,"GENERAL",branch,branch,branch,"name"); }
  H5Product product(long id,String type) { return new H5Product(id,"C","Name",null,null,null,null,null,null,type,"ALL",false,true,true,"ACTIVE",0,0,List.of(),List.of(),null); }

  @Test void cacheHitReadsContextOnceAndFiltersUsingCurrentIdentity() {
    when(data.context("A",identity)).thenReturn(context(1,"new"));
    var snapshot=new Snapshot(2,1,99,List.of(product(1,"GENERAL"),product(2,"SPECIAL"),product(3,"ALL")),
        Map.of(1L,new Rule(Set.of("new"),Map.of()),3L,new Rule(Set.of("old"),Map.of())));
    when(cache.lookup(2,1)).thenReturn(new H5CatalogCache.Lookup(snapshot,false));
    assertThat(service(true).products("A",identity,null,null)).extracting(H5Product::id).containsExactly(1L);
    verify(data).context("A",identity); verify(data,never()).legacy(any(),any(),any(),any(),any());
  }

  @Test void permissionsAreRecheckedAfterWaitingAndVersionRacesRetry() {
    when(data.context("A",identity)).thenReturn(context(1,"old"),context(2,"new"));
    when(cache.lookup(2,1)).thenReturn(new H5CatalogCache.Lookup(new Snapshot(2,1,99,List.of(),Map.of()),true));
    when(cache.lookup(2,2)).thenReturn(new H5CatalogCache.Lookup(new Snapshot(2,2,99,List.of(product(1,"ALL")),Map.of()),false));
    assertThat(service(true).products("A",identity,null,null)).extracting(H5Product::id).containsExactly(1L);
    verify(data,times(2)).context("A",identity);
  }

  @Test void revokedIdentityAfterColdLoadIsRejected() {
    when(data.context("A",identity)).thenReturn(context(1,"old")).thenThrow(DomainException.unauthorized("invalid"));
    when(cache.lookup(2,1)).thenReturn(new H5CatalogCache.Lookup(new Snapshot(2,1,99,List.of(product(1,"ALL")),Map.of()),true));
    assertThatThrownBy(() -> service(true).products("A",identity,null,null)).isInstanceOf(DomainException.class);
  }

  @Test void aNotificationBetweenContextReadAndCacheHitRechecksTheDatabase() {
    when(data.context("A",identity)).thenReturn(context(1,"old"),context(2,"new"));
    when(cache.lookup(2,1)).thenReturn(new H5CatalogCache.Lookup(new Snapshot(2,2,99,List.of(product(1,"ALL")),Map.of()),false));
    assertThat(service(true).products("A",identity,null,null)).extracting(H5Product::id).containsExactly(1L);
    verify(data,times(2)).context("A",identity);
  }

  @Test void disabledCacheAndSqlFiltersUseTheExistingSqlSemantics() {
    var current=context(1,"new"); when(data.context("A",identity)).thenReturn(current);
    when(data.legacy("A",current,identity,null,null)).thenReturn(List.of());
    when(data.legacy("A",current,identity,null,"%_é")).thenReturn(List.of());
    service(false).products("A",identity,null,null); service(true).products("A",identity,null,"%_é");
    verify(data).legacy("A",current,identity,null,null); verify(data).legacy("A",current,identity,null,"%_é"); verifyNoInteractions(cache);
  }

  @Test void emptyOrInvalidatedDealerSelectionNeverGrantsAccess() {
    var context=context(1,"branch");
    assertThat(new Rule(Set.of(),Map.of("branch",Set.of())).allows(context)).isFalse();
    assertThat(new Rule(Set.of(),Map.of("branch",Set.of(new Member(4,"SPECIAL","name")))).allows(context)).isFalse();
    assertThat(new Rule(Set.of(),Map.of("branch",Set.of(new Member(4,"GENERAL","other")))).allows(context)).isFalse();
    assertThat(new Rule(Set.of(),Map.of("branch",Set.of(new Member(4,"GENERAL","name")))).allows(context)).isTrue();
    assertThat(new Rule(Set.of(),Map.of("other",Set.of())).allows(context)).isTrue();
  }
}
