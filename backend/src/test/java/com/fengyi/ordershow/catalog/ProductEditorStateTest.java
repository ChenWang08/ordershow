package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.storage.StorageService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ProductEditorStateTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final ProductCatalogReader reader = spy(new ProductCatalogReader(jdbc, mock(ActivityService.class)));
  private ProductService.ProductView product(long id, String name) {
    var p = mock(ProductService.ProductView.class); when(p.id()).thenReturn(id); when(p.materialName()).thenReturn(name); return p;
  }
  @Test void editorTargetMustBelongToCurrentVisibleVersionAndActivity() {
    doReturn(77L).when(reader).currentVersion(7);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(call -> {
      assertThat(call.getArgument(0, String.class)).contains("activity_id=?", "data_version_id=?", "id=?", "is_visible=TRUE");
      assertThat((Object[])call.getRawArguments()[2]).containsExactly(7L,77L,42L);
      return List.of();
    });
    assertThatThrownBy(() -> reader.editorProducts(7,42,List.of())).isInstanceOf(DomainException.class)
      .extracting(e -> ((DomainException)e).code()).isEqualTo("PRODUCT_NOT_FOUND");
  }
  @Test void detailOnlyRefreshDoesNotEnumerateOtherProducts() {
    var target = product(42,"商品"); doReturn(77L).when(reader).currentVersion(7);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(target));
    doReturn(List.of(target)).when(reader).withDetails(List.of(target));
    assertThat(reader.editorProducts(7,42,List.of())).containsExactly(target);
    verify(jdbc,times(1)).query(anyString(),any(RowMapper.class),any(Object[].class));
  }
  @Test void imageRefreshIncludesOldNewNormalizedNameGroupsAndExcludesUnrelatedRows() {
    var target = product(42,"新品 A"); var sibling = product(43,"旧品 B");
    doReturn(77L).when(reader).currentVersion(7);
    doAnswer(call -> call.getArgument(0)).when(reader).withDetails(anyList());
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(call -> {
      String sql=call.getArgument(0);
      assertThat(sql).contains("activity_id=?", "data_version_id=?", "is_visible=TRUE");
      Object[] args=(Object[])call.getRawArguments()[2]; assertThat(args[0]).isEqualTo(7L); assertThat(args[1]).isEqualTo(77L);
      if(sql.contains("AND id=?")) return List.of(target);
      if(sql.startsWith("SELECT id,material_name")) return List.of(new AbstractMap.SimpleImmutableEntry<>(42L,"新品A"),new AbstractMap.SimpleImmutableEntry<>(43L,"旧品-B"),new AbstractMap.SimpleImmutableEntry<>(99L,"无关"));
      assertThat(args).containsExactly(7L,77L,42L,43L); return List.of(target,sibling);
    });
    assertThat(reader.editorProducts(7,42,List.of("旧品 B"))).containsExactly(target,sibling);
  }
  @Test void invalidGroupInputFailsBeforeDatabaseAccess() {
    assertThatThrownBy(() -> reader.editorProducts(7,42,Collections.nCopies(13,"a"))).isInstanceOf(DomainException.class);
    assertThatThrownBy(() -> reader.editorProducts(7,42,List.of("a".repeat(513)))).isInstanceOf(DomainException.class);
    verifyNoInteractions(jdbc);
  }
  @Test void controllerRequiresAdminAndPreservesCommasInMaterialNames() throws Exception {
    var service=mock(ProductService.class); var auth=mock(AuthService.class); var scopes=mock(ProductDealerScopeService.class);
    var controller=new ProductController(service,auth,scopes,mock(H5CatalogService.class),jdbc,new com.fasterxml.jackson.databind.ObjectMapper());
    when(service.editorProducts(7,42,List.of("商品,A"))).thenReturn(List.of());
    var mvc=MockMvcBuilders.standaloneSetup(controller).build();
    mvc.perform(get("/admin/activities/7/products/42/editor-state").param("imageGroupNames","商品,A")).andExpect(status().isOk());
    verify(auth).requireAdmin(any()); verify(service).editorProducts(7,42,List.of("商品,A"));
    verify(scopes).summaries(7,List.of()); verify(service).editorReviews(7,List.of());
    reset(service,auth,scopes); doThrow(DomainException.forbidden("NO_ACCESS","无权限")).when(auth).requireAdmin(any());
    assertThatThrownBy(() -> controller.editorState(7,42,new LinkedMultiValueMap<>(),new MockHttpServletRequest())).isInstanceOf(DomainException.class);
    verifyNoInteractions(service,scopes);
  }
  @Test void targetedScopesKeepTypeBranchAndInvalidMemberRules() {
    var scopes=spy(new ProductDealerScopeService(jdbc)); var p=product(42,"商品");
    when(p.customerType()).thenReturn("GENERAL"); when(p.branchScope()).thenReturn(List.of("A"));
    doReturn(List.of(new ProductDealerScopeService.Candidate(1,"一","","A","GENERAL"),
      new ProductDealerScopeService.Candidate(2,"二","","A","GENERAL"),
      new ProductDealerScopeService.Candidate(3,"三","","B","GENERAL"),
      new ProductDealerScopeService.Candidate(4,"四","","A","SPECIAL"))).when(scopes).candidates(7);
    doReturn(Map.of(42L,List.of(new ProductDealerScopeService.Scope("A",List.of(
      new ProductDealerScopeService.Member(1,"一","GENERAL",true), new ProductDealerScopeService.Member(2,"二","GENERAL",false))))))
      .when(scopes).read(7,List.of(42L));
    var result=scopes.summaries(7,List.of(p)); assertThat(result.keySet()).containsExactly(42L);
    assertThat(result.get(42L).effectiveCount()).isEqualTo(1); assertThat(result.get(42L).selectedCount()).isEqualTo(1);
    assertThat(result.get(42L).restricted()).isTrue(); verifyNoInteractions(jdbc);
  }
  @Test void targetedReviewsAreNormalizedAndRestrictedToCurrentActivityVersion() {
    var images=new ProductImageService(jdbc,mock(ActivityService.class),mock(StorageService.class),reader);
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenAnswer(call -> {
      assertThat(call.getArgument(0,String.class)).contains("b.current_version_id = c.data_version_id", "c.activity_id = ?", "c.normalized_material_name IN (?)");
      assertThat((Object[])call.getRawArguments()[2]).containsExactly(7L, ProductImageMatcher.materialNameKey("商品 A")); return List.of();
    });
    images.pendingImageReviews(7,List.of("商品 A","商品-A"));
    verify(jdbc,times(1)).query(anyString(),any(RowMapper.class),any(Object[].class));
  }
}
