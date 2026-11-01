package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class ImageVariantServiceTest {
  final StorageService storage = mock(StorageService.class);
  final StorageService.FileMeta meta = new StorageService.FileMeta(3, "bucket", "key", "photo.png", "image/png", 1000);
  @Test void oldImagesArePersistedOnceAndConcurrentRequestsShareOneRead() throws Exception {
    var bytes = new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(640, 320, BufferedImage.TYPE_INT_RGB), "png", bytes);
    when(storage.read(meta)).thenReturn(bytes.toByteArray());
    var started = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(storage.readVariant(meta, ImageVariants.Kind.THUMBNAIL)).thenAnswer(call -> { started.countDown(); release.await(2, TimeUnit.SECONDS); return null; });
    var service = new ImageVariantService(storage);
    try (var pool = Executors.newFixedThreadPool(4)) {
      var first = CompletableFuture.supplyAsync(() -> service.read(meta, ImageVariants.Kind.THUMBNAIL), pool);
      assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
      var second = CompletableFuture.supplyAsync(() -> service.read(meta, ImageVariants.Kind.THUMBNAIL), pool);
      release.countDown();
      assertThat(first.get(3, TimeUnit.SECONDS)).isSameAs(second.get(3, TimeUnit.SECONDS));
      assertThat(service.read(meta, ImageVariants.Kind.THUMBNAIL)).isSameAs(first.get());
    }
    verify(storage, times(1)).read(meta);
    verify(storage, times(1)).writeVariant(eq(meta), eq(ImageVariants.Kind.THUMBNAIL), any());
    var cached = new ImageVariants.Encoded(new byte[]{1}, "image/png");
    when(storage.readVariant(meta, ImageVariants.Kind.THUMBNAIL)).thenReturn(cached);
    assertThat(new ImageVariantService(storage).read(meta, ImageVariants.Kind.THUMBNAIL)).isSameAs(cached);
    verify(storage, times(1)).read(meta);
  }
  @Test void conditionalResponsesSkipStorageAndPrivateOrDeletedFilesCannotBeTransformed() {
    var jdbc = mock(JdbcTemplate.class); var variants = mock(ImageVariantService.class);
    var controller = new FileController(storage, jdbc, mock(com.fengyi.ordershow.security.AuthService.class),
        mock(com.fengyi.ordershow.security.DepartmentAccessService.class), variants);
    String sql = "SELECT activity_id,file_purpose FROM stored_file WHERE id=? AND deleted_at IS NULL";
    when(jdbc.queryForList(sql, 3L)).thenReturn(java.util.List.of(java.util.Map.of("activity_id", 1L, "file_purpose", "PRODUCT_IMAGE")));
    when(storage.meta(3)).thenReturn(meta);
    when(variants.read(meta, ImageVariants.Kind.THUMBNAIL)).thenReturn(new ImageVariants.Encoded(new byte[]{1,2}, "image/png"));
    var request = new MockHttpServletRequest("GET", "/public/files/3/thumbnail");
    var response = controller.thumbnail(3, request);
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getHeaders().getCacheControl()).contains("max-age=2592000", "immutable");
    request.addHeader("If-None-Match", response.getHeaders().getETag());
    assertThat(controller.thumbnail(3, request).getStatusCode().value()).isEqualTo(304);
    verify(variants, times(1)).read(any(), any()); verify(storage, times(1)).meta(3);
    when(jdbc.queryForList(sql, 3L)).thenReturn(java.util.List.of(java.util.Map.of("activity_id", 1L, "file_purpose", "IMPORT_SOURCE")));
    assertThatThrownBy(() -> controller.thumbnail(3, request)).isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
    when(jdbc.queryForList(sql, 3L)).thenReturn(java.util.List.of());
    assertThatThrownBy(() -> controller.thumbnail(3, request)).isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
  }
}
