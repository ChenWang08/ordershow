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

  public ProductController(ProductService service, AuthService auth) { this.service = service; this.auth = auth; }

  @GetMapping("/h5/activities/{activityCode}/products")
  ApiResponse<List<ProductService.ProductView>> h5(@PathVariable String activityCode,
      @RequestParam(required = false) String rebateStatus, @RequestParam(required = false) String keyword, HttpServletRequest request) {
    return ApiResponse.of(service.h5Products(activityCode, auth.requireH5(request), rebateStatus, keyword), TraceFilter.id(request));
  }

  @GetMapping("/admin/activities/{activityId}/products")
  ApiResponse<List<ProductService.ProductView>> admin(@PathVariable long activityId,
      @RequestParam(required = false) String customerType, @RequestParam(required = false) String status,
      @RequestParam(required = false) String keyword, HttpServletRequest request) {
    return ApiResponse.of(service.adminProducts(activityId, customerType, status, keyword), TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/products")
  ApiResponse<ProductService.ProductView> create(@PathVariable long activityId,
      @RequestBody ProductService.ProductCreate body, HttpServletRequest request) {
    auth.requireAdmin(request);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.create(activityId, body), TraceFilter.id(request));
  }

  @PatchMapping("/admin/activities/{activityId}/products/{productId}")
  ApiResponse<ProductService.ProductView> update(@PathVariable long activityId, @PathVariable long productId,
      @RequestHeader("If-Match") String ifMatch, @RequestBody ProductService.ProductPatch body, HttpServletRequest request) {
    auth.requireAdmin(request);
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, body.reason());
    return ApiResponse.of(service.update(activityId, productId, Integer.parseInt(ifMatch.replace("\"", "")), body), TraceFilter.id(request));
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
    service.updateImage(activityId, productId, imageId, body.primary(), body.sortNo());
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @DeleteMapping("/admin/activities/{activityId}/products/{productId}/images/{imageId}")
  ApiResponse<Boolean> deleteImage(@PathVariable long activityId, @PathVariable long productId, @PathVariable long imageId, HttpServletRequest request) {
    service.deleteImage(activityId, productId, imageId);
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @PostMapping("/admin/activities/{activityId}/product-images/zip")
  ApiResponse<ProductService.ZipPreview> zip(@PathVariable long activityId, @RequestParam MultipartFile file,
      @RequestParam(defaultValue = "false") boolean confirm, HttpServletRequest request) {
    return ApiResponse.of(service.previewZip(activityId, file, confirm, auth.requireAdmin(request).id()), TraceFilter.id(request));
  }

  public record ImagePatch(Boolean primary, Integer sortNo, String reason) {}
}
