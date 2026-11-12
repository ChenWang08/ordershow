package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.catalog.ProductService.ProductView;
import com.fengyi.ordershow.catalog.ProductService.ZipDecision;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.storage.StorageService;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;

class ProductImageServiceTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final StorageService storage = mock(StorageService.class);
  private final ProductCatalogReader catalog = mock(ProductCatalogReader.class);
  private final ProductImageService service = new ProductImageService(jdbc, mock(ActivityService.class), storage, catalog);

  @Test
  void previewDoesNotWriteImagesOrDatabaseRows() throws Exception {
    when(catalog.adminProducts(7, null, null, null)).thenReturn(List.of());
    try (var bytes = new ByteArrayOutputStream()) {
      try (var zip = new ZipOutputStream(bytes)) {
        zip.putNextEntry(new ZipEntry("商品.jpg")); zip.write(new byte[]{1, 2, 3}); zip.closeEntry();
      }
      var preview = service.previewZip(7, new MockMultipartFile("file", "images.zip", "application/zip", bytes.toByteArray()), false, 1);
      assertThat(preview.imageCount()).isEqualTo(1);
      assertThat(preview.unmatchedCount()).isEqualTo(1);
      assertThat(preview.committed()).isFalse();
      verifyNoInteractions(jdbc, storage);
    }
  }

  @Test
  void emptyImageArchiveRetainsTheExistingErrorCode() {
    when(catalog.adminProducts(7, null, null, null)).thenReturn(List.of());
    assertThatThrownBy(() -> service.previewZip(7, new MockMultipartFile("file", "images.zip", "application/zip", new byte[]{1, 2, 3}), false, 1))
        .isInstanceOf(DomainException.class).satisfies(error -> assertThat(((DomainException) error).code()).isEqualTo("IMAGE_ZIP_EMPTY"));
    verifyNoInteractions(jdbc, storage);
  }

  @Test
  void zipPublicationChecksDecompressedImageSizeAndReportsTheEntryPath() throws Exception {
    int limit = 2 * 1024 * 1024;
    when(catalog.productsForVersion(7, 2)).thenReturn(List.of());
    when(storage.read(3)).thenReturn(imageZip("at-limit.jpg", limit));
    assertThat(service.attachZipToVersion(7, 2, 3, 1).imageCount()).isEqualTo(1);

    String oversizedPath = "products/too-large.jpg";
    byte[] compressed = imageZip(oversizedPath, limit + 1);
    assertThat(compressed.length).isLessThan(limit);
    when(storage.read(3)).thenReturn(compressed);
    assertThatThrownBy(() -> service.attachZipToVersion(7, 2, 3, 1))
        .isInstanceOf(DomainException.class)
        .hasMessageContaining("2 MiB")
        .hasMessageContaining(oversizedPath)
        .satisfies(error -> assertThat(((DomainException) error).code()).isEqualTo("IMAGE_TOO_LARGE"));
  }

  @Test
  void confirmedZipPathsWithIdenticalBytesShareStorageAndKeepBothProductLinks() throws Exception {
    byte[] content = {1, 2, 3};
    var archive = new ByteArrayOutputStream();
    try (var zip = new ZipOutputStream(archive)) {
      for (String path : List.of("unused.jpg", "first.jpg", "second.jpg")) {
        zip.putNextEntry(new ZipEntry(path));
        zip.write(content);
        zip.closeEntry();
      }
    }
    when(storage.read(3)).thenReturn(archive.toByteArray());
    when(catalog.productsForVersion(7, 2)).thenReturn(List.of(product(11, "First"), product(12, "Second")));
    when(jdbc.queryForObject(anyString(), eq(Integer.class), anyLong())).thenReturn(0);
    when(jdbc.queryForList(contains("FROM stored_file"), eq(Long.class), eq(7L), any(byte[].class)))
        .thenReturn(List.of()).thenReturn(List.of(90L));
    when(storage.save(7, "first.jpg", "image/jpeg", content, "PRODUCT_IMAGE", 1L))
        .thenReturn(new StorageService.StoredFile(90, 7, "key", "first.jpg", "image/jpeg", content.length, null));

    var preview = service.attachZipToVersion(7, 2, 3, 1, List.of(
        new ZipDecision("unused.jpg", "UNMATCHED", List.of()),
        new ZipDecision("first.jpg", "CONFIRMED", List.of("First")),
        new ZipDecision("second.jpg", "CONFIRMED", List.of("Second"))));

    assertThat(preview.matchedCount()).isEqualTo(2);
    assertThat(preview.unmatchedCount()).isEqualTo(1);
    verify(storage).save(eq(7L), anyString(), eq("image/jpeg"), any(byte[].class), eq("PRODUCT_IMAGE"), eq(1L));
    verify(jdbc).update(contains("INSERT INTO product_image("), eq(11L), eq(90L), eq(true), eq(0), eq("CONFIRMED"), eq(1L));
    verify(jdbc).update(contains("INSERT INTO product_image("), eq(12L), eq(90L), eq(true), eq(0), eq("CONFIRMED"), eq(1L));
  }

  private static ProductView product(long id, String name) {
    return new ProductView(id, "", name, null, null, null, null, null, null, null, null, null, null,
        "ALL", "ALL", false, true, true, "VALID", 0, 0, List.of(), List.of(), null);
  }

  private static byte[] imageZip(String path, int imageSize) throws Exception {
    var bytes = new ByteArrayOutputStream();
    try (var zip = new ZipOutputStream(bytes)) {
      zip.putNextEntry(new ZipEntry(path));
      zip.write(new byte[imageSize]);
      zip.closeEntry();
    }
    return bytes.toByteArray();
  }
}
