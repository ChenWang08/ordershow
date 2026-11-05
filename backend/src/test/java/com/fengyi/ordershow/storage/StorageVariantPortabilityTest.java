package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ConcurrentHashMap;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class StorageVariantPortabilityTest {
  final ObjectStorage objects = mock(ObjectStorage.class);
  StorageService storage() {
    var properties = mock(OrderShowProperties.class);
    when(properties.storage()).thenReturn(new OrderShowProperties.Storage("", "", "", "shared"));
    var jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(anyString(), eq(Long.class), anyLong())).thenReturn(java.util.List.of(1L));
    return new StorageService(properties, jdbc, objects);
  }

  @Test void separateReplicasReuseDerivativesThroughTheSharedStoragePort() throws Exception {
    var saved = new ConcurrentHashMap<String, byte[]>();
    when(objects.readIfPresent(eq("shared"), anyString())).thenAnswer(call -> {
      byte[] bytes = saved.get(call.getArgument(1, String.class));
      return bytes == null ? null : new ByteArrayInputStream(bytes);
    });
    doAnswer(call -> { saved.put(call.getArgument(1), ((java.io.InputStream)call.getArgument(2)).readAllBytes()); return null; })
        .when(objects).put(eq("shared"), anyString(), any(java.io.InputStream.class), anyLong(), anyString());
    for (boolean alpha : new boolean[]{false, true}) {
      var source = new ByteArrayOutputStream();
      ImageIO.write(new BufferedImage(640, 320, alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB), "png", source);
      String key = alpha ? "alpha.png" : "opaque.png";
      when(objects.read("shared", key)).thenAnswer(call -> new ByteArrayInputStream(source.toByteArray()));
      var meta = new StorageService.FileMeta(alpha ? 2 : 1, "shared", key, key, "image/png", source.size());
      var first = new ImageVariantService(storage()).read(meta, ImageVariants.Kind.THUMBNAIL);
      var second = new ImageVariantService(storage()).read(meta, ImageVariants.Kind.THUMBNAIL);
      assertThat(second.bytes()).isEqualTo(first.bytes());
      assertThat(second.contentType()).isEqualTo(alpha ? "image/png" : "image/jpeg");
      assertThat(ImageIO.read(new ByteArrayInputStream(second.bytes())).getWidth()).isEqualTo(320);
      verify(objects, times(1)).read("shared", key);
    }
    assertThat(saved).hasSize(2);
  }

  @Test void storageErrorsDoNotTriggerAnOriginalReadAndRegeneration() throws Exception {
    when(objects.readIfPresent(anyString(), anyString())).thenThrow(new java.io.IOException("denied or offline"));
    var meta = new StorageService.FileMeta(1, "shared", "image.png", "image.png", "image/png", 1);
    assertThatThrownBy(() -> new ImageVariantService(storage()).read(meta, ImageVariants.Kind.THUMBNAIL))
        .isInstanceOfSatisfying(DomainException.class, error -> assertThat(error.code()).isEqualTo("IMAGE_PREVIEW_BUSY"));
    verify(objects, never()).read(anyString(), anyString());
    verify(objects, never()).put(anyString(), anyString(), any(java.io.InputStream.class), anyLong(), anyString());
  }
}
