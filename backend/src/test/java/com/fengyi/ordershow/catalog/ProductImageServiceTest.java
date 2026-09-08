package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fengyi.ordershow.activity.ActivityService;
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
}
