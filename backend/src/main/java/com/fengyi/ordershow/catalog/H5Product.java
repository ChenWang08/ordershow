package com.fengyi.ordershow.catalog;

import java.math.BigDecimal;
import java.util.List;

/** H5 presentation contract. Administrative image metadata never leaves this endpoint. */
public record H5Product(long id, String materialCode, String materialName, String description,
    String categoryName, String productLine, String specification, String casePack, BigDecimal casePrice,
    String customerType, String rebateStatus, boolean giftBox, boolean visible, boolean orderable,
    String dataStatus, int sortNo, int version, List<Image> images, List<String> branchScope,
    ProductService.PriceTierView priceTier) {
  public H5Product { images = List.copyOf(images); branchScope = List.copyOf(branchScope); }
  public static H5Product from(ProductService.ProductView product) {
    return new H5Product(product.id(), product.materialCode(), product.materialName(), product.description(),
        product.categoryName(), product.productLine(), product.specification(), product.casePack(), product.casePrice(),
        product.customerType(), product.rebateStatus(), product.giftBox(), product.visible(), product.orderable(),
        product.dataStatus(), product.sortNo(), product.version(), product.images().stream()
            .map(image -> new Image(image.id(), image.url(), image.primary(), image.sortNo())).toList(),
        product.branchScope(), product.priceTier());
  }

  public record Image(long id, String url, boolean primary, int sortNo) {}
}
