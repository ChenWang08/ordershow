package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import com.fengyi.ordershow.common.DomainException;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Random;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class ImageVariantsTest {
  @Test void longFilenamesUseABoundedStableDerivativeKey() {
    var meta = new StorageService.FileMeta(1, "bucket", "1/product_image/" + "图".repeat(80) + ".png", "image.png", "image/png", 1);
    String thumbnail = StorageService.variantObjectKey(meta, ImageVariants.Kind.THUMBNAIL);
    assertThat(thumbnail.substring(thumbnail.lastIndexOf('/') + 1).getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThanOrEqualTo(255);
    assertThat(StorageService.variantObjectKey(meta, ImageVariants.Kind.THUMBNAIL)).isEqualTo(thumbnail);
    assertThat(StorageService.variantObjectKey(meta, ImageVariants.Kind.DISPLAY)).isNotEqualTo(thumbnail);
  }
  private static byte[] encode(BufferedImage image, String format) throws Exception {
    var bytes = new ByteArrayOutputStream();
    assertThat(ImageIO.write(image, format, bytes)).isTrue();
    return bytes.toByteArray();
  }
  @Test void aLargeOriginalProducesASmallRealImageAndALargerDisplayVariant() throws Exception {
    var image = new BufferedImage(1600, 800, BufferedImage.TYPE_INT_RGB);
    var random = new Random(42);
    for (int y = 0; y < 800; y++) for (int x = 0; x < 1600; x++) image.setRGB(x, y, random.nextInt(0xffffff));
    byte[] original = encode(image, "jpeg");
    var thumbnail = ImageVariants.render(original, ImageVariants.Kind.THUMBNAIL);
    var decoded = ImageIO.read(new ByteArrayInputStream(thumbnail.bytes()));
    assertThat(decoded.getWidth()).isEqualTo(320); assertThat(decoded.getHeight()).isEqualTo(160);
    assertThat(thumbnail.bytes().length).isLessThan(original.length / 5);
    var display = ImageIO.read(new ByteArrayInputStream(ImageVariants.render(original, ImageVariants.Kind.DISPLAY).bytes()));
    assertThat(display.getWidth()).isEqualTo(960); assertThat(display.getHeight()).isEqualTo(480);
  }
  @Test void transparencyAndSmallImageDimensionsArePreserved() throws Exception {
    var image = new BufferedImage(80, 40, BufferedImage.TYPE_INT_ARGB);
    image.setRGB(10, 10, 0x8000ff00);
    var result = ImageVariants.render(encode(image, "png"), ImageVariants.Kind.THUMBNAIL);
    assertThat(result.contentType()).isEqualTo("image/png");
    var decoded = ImageIO.read(new ByteArrayInputStream(result.bytes()));
    assertThat(decoded.getWidth()).isEqualTo(80); assertThat(decoded.getHeight()).isEqualTo(40);
    assertThat(decoded.getRGB(0, 0) >>> 24).isZero();
    assertThat(decoded.getRGB(10, 10) >>> 24).isEqualTo(128);
  }
  @Test void supportedRasterInputsAndInvalidBytesAreHandled() throws Exception {
    var image = new BufferedImage(40, 20, BufferedImage.TYPE_INT_RGB);
    for (String format : java.util.List.of("jpeg", "png", "gif", "bmp")) {
      var result = ImageVariants.render(encode(image, format), ImageVariants.Kind.THUMBNAIL);
      assertThat(ImageIO.read(new ByteArrayInputStream(result.bytes())).getWidth()).isEqualTo(40);
    }
    byte[] webp = java.util.Base64.getDecoder().decode("UklGRm4AAABXRUJQVlA4WAoAAAAQAAAAJwAAEwAAQUxQSAoAAAABB1DAiAhERP8DVlA4ID4AAABwAwCdASooABQAPm02l0ikIyIhJWgAgA2JZwB2APwAAF8XVTAA/u4KZ//vvQG8n///uDj2Dj2Dj90wAAAAAA==");
    var decodedWebp = ImageIO.read(new ByteArrayInputStream(ImageVariants.render(webp, ImageVariants.Kind.THUMBNAIL).bytes()));
    assertThat(decodedWebp.getWidth()).isEqualTo(40);
    assertThat(decodedWebp.getHeight()).isEqualTo(20);
    assertThatThrownBy(() -> ImageVariants.render(new byte[]{1, 2, 3}, ImageVariants.Kind.THUMBNAIL)).isInstanceOf(DomainException.class);
  }
  @Test void exifRotationIsAppliedBeforeSizing() throws Exception {
    var image = new BufferedImage(200, 100, BufferedImage.TYPE_INT_RGB);
    var graphics = image.createGraphics(); graphics.setColor(Color.RED); graphics.fillRect(0, 0, 100, 100);
    graphics.setColor(Color.BLUE); graphics.fillRect(100, 0, 100, 100); graphics.dispose();
    byte[] jpeg = encode(image, "jpeg");
    byte[] exif = new byte[]{69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0};
    var bytes = new ByteArrayOutputStream(); bytes.write(jpeg, 0, 2); bytes.write(255); bytes.write(225);
    bytes.write((exif.length + 2) >> 8); bytes.write(exif.length + 2); bytes.write(exif); bytes.write(jpeg, 2, jpeg.length - 2);
    var decoded = ImageIO.read(new ByteArrayInputStream(ImageVariants.render(bytes.toByteArray(), ImageVariants.Kind.THUMBNAIL).bytes()));
    assertThat(decoded.getWidth()).isEqualTo(100); assertThat(decoded.getHeight()).isEqualTo(200);
    assertThat(new Color(decoded.getRGB(50, 20)).getRed()).isGreaterThan(200);
    assertThat(new Color(decoded.getRGB(50, 180)).getBlue()).isGreaterThan(200);
  }
}
