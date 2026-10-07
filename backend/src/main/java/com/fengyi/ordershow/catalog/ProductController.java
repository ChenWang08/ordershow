package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ProductController {
  private final ProductService service;
  private final AuthService auth;
  private final ProductDealerScopeService scopes;
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final com.fasterxml.jackson.databind.ObjectMapper json;

  public ProductController(ProductService service, AuthService auth, ProductDealerScopeService scopes,
      org.springframework.jdbc.core.JdbcTemplate jdbc, com.fasterxml.jackson.databind.ObjectMapper json) {
    this.service = service; this.auth = auth; this.scopes=scopes; this.jdbc=jdbc; this.json=json;
  }

  @GetMapping("/admin/activities/{activityId}/product-dealer-scopes")
  ApiResponse<java.util.Map<Long,ProductDealerScopeService.ScopeSummary>> scopes(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(scopes.summaries(activityId), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/product-dealer-candidates")
  ApiResponse<List<ProductDealerScopeService.Candidate>> candidates(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(scopes.candidates(activityId), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/products/{productId}/scope-history")
  ApiResponse<List<java.util.Map<String,Object>>> history(@PathVariable long activityId, @PathVariable long productId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(jdbc.queryForList("""
        SELECT l.before_json,l.after_json,l.reason,l.created_at,u.display_name
        FROM product_scope_change_log l LEFT JOIN admin_user u ON u.id=l.admin_user_id
        WHERE l.activity_id=? AND l.activity_product_id=? ORDER BY l.id DESC LIMIT 100
        """,activityId,productId),TraceFilter.id(request));
  }

  @GetMapping("/h5/activities/{activityCode}/products")
  ApiResponse<List<ProductService.ProductView>> h5(@PathVariable String activityCode,
      @RequestParam(required = false) String rebateStatus, @RequestParam(required = false) String keyword, HttpServletRequest request) {
    return ApiResponse.of(service.h5Products(activityCode, auth.requireH5(request), rebateStatus, keyword), TraceFilter.id(request));
  }

  @GetMapping({"/admin/activities/{activityId}/products", "/admin/activities/{activityId}/orders/product-options"})
  ApiResponse<List<ProductService.ProductView>> admin(@PathVariable long activityId,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String status,
      @RequestParam(required = false) String keyword, @RequestParam(required = false) Long activityCustomerId,
      HttpServletRequest request) {
    return ApiResponse.of(service.adminProducts(activityId, customerType, status, keyword, activityCustomerId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/products")
  ApiResponse<ProductService.ProductView> create(@PathVariable long activityId,
      @RequestBody ProductService.ProductCreate body, HttpServletRequest request) {
    auth.requireAdmin(request);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.create(activityId, body), TraceFilter.id(request));
  }

  @PatchMapping("/admin/activities/{activityId}/products/{productId}")
  @org.springframework.transaction.annotation.Transactional
  ApiResponse<ProductService.ProductView> update(@PathVariable long activityId, @PathVariable long productId,
      @RequestHeader("If-Match") String ifMatch, @RequestBody ProductService.ProductPatch body, HttpServletRequest request) {
    var admin=auth.requireAdmin(request);
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE",activityId);
    String before=scopeSnapshot(activityId,productId);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    var saved=service.update(activityId, productId, Integer.parseInt(ifMatch.replace("\"", "")), body);
    String after=scopeSnapshot(activityId,productId);
    if(!before.equals(after)) jdbc.update("""
        INSERT INTO product_scope_change_log(activity_id,activity_product_id,admin_user_id,before_json,after_json,reason)
        VALUES (?,?,?,?,?,?)
        """,activityId,productId,admin.id(),before,after,java.util.Objects.requireNonNullElse(body.reason(),""));
    return ApiResponse.of(saved, TraceFilter.id(request));
  }

  private String scopeSnapshot(long activityId,long productId) {
    var p=service.product(activityId,productId);
    try { return json.writeValueAsString(java.util.Map.of("customerType",p.customerType(),"branchScope",p.branchScope(),
        "dealerScope",scopes.read(activityId,List.of(productId)).getOrDefault(productId,List.of()))); }
    catch(Exception e) { throw new IllegalStateException("范围日志序列化失败",e); }
  }

  @DeleteMapping("/admin/activities/{activityId}/products/{productId}")
  ApiResponse<Boolean> delete(@PathVariable long activityId, @PathVariable long productId,
      @RequestHeader("If-Match") String ifMatch, HttpServletRequest request) {
    auth.requireAdmin(request);
    service.delete(activityId, productId, Integer.parseInt(ifMatch.replace("\"", "")));
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/products/{productId}/images")
  ApiResponse<ProductService.ImageView> image(@PathVariable long activityId, @PathVariable long productId,
      @RequestParam MultipartFile file, @RequestParam(defaultValue = "false") boolean primary, HttpServletRequest request) {
    return ApiResponse.of(service.addImage(activityId, productId, file, primary, auth.requireAdmin(request).id()), TraceFilter.id(request));
  }

  @PatchMapping("/admin/activities/{activityId}/products/{productId}/images/{imageId}")
  ApiResponse<Boolean> updateImage(@PathVariable long activityId, @PathVariable long productId, @PathVariable long imageId,
      @RequestBody ImagePatch body, HttpServletRequest request) {
    auth.requireAdmin(request);
    service.updateImage(activityId, productId, imageId, body.primary(), body.sortNo());
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/products/{productId}/images/{imageId}")
  ApiResponse<Boolean> deleteImage(@PathVariable long activityId, @PathVariable long productId, @PathVariable long imageId, HttpServletRequest request) {
    auth.requireAdmin(request);
    service.deleteImage(activityId, productId, imageId);
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/product-image-reviews")
  ApiResponse<List<ProductService.ImageReviewView>> imageReviews(@PathVariable long activityId, HttpServletRequest request) {
    auth.requireAdmin(request);
    return ApiResponse.of(service.pendingImageReviews(activityId), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/product-image-reviews/{candidateId}/select")
  ApiResponse<Boolean> selectImageReview(@PathVariable long activityId, @PathVariable long candidateId, HttpServletRequest request) {
    service.selectImageReview(activityId, candidateId, auth.requireAdmin(request).id());
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/product-image-reviews/{candidateId}")
  ApiResponse<Boolean> excludeImageReview(@PathVariable long activityId, @PathVariable long candidateId, HttpServletRequest request) {
    service.excludeImageReview(activityId, candidateId, auth.requireAdmin(request).id());
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/product-images/zip")
  ApiResponse<ProductService.ZipPreview> zip(@PathVariable long activityId, @RequestParam MultipartFile file,
      HttpServletRequest request) {
    return ApiResponse.of(service.previewZip(activityId, file, false, auth.requireAdmin(request).id()), TraceFilter.id(request));
  }

  public record ImagePatch(Boolean primary, Integer sortNo, String reason) {}
}
