package com.fengyi.ordershow.storage;

import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.exif.ExifIFD0Directory;
import com.fengyi.ordershow.common.DomainException;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** Fixed, versioned sizes prevent arbitrary transformations on public requests. */
public final class ImageVariants {
  public static final int VERSION = 1;
  private static final Semaphore encoders = new Semaphore(2);
  private ImageVariants() {}
  public enum Kind {
    THUMBNAIL(320), DISPLAY(960);
    final int edge;
    Kind(int edge) { this.edge = edge; }
    String key() { return ".image-v" + VERSION + "-" + name().toLowerCase(java.util.Locale.ROOT); }
  }
  public record Encoded(byte[] bytes, String contentType) {}
  public static String thumbnailUrl(long fileId) { return "/api/v1/public/files/" + fileId + "/thumbnail?v=" + VERSION; }

  public static Encoded render(byte[] source, Kind kind) {
    boolean acquired = false;
    try {
      acquired = encoders.tryAcquire(10, TimeUnit.SECONDS);
      if (!acquired) throw busy();
      if (source.length > 10 * 1024 * 1024) throw invalid();
      try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
        var readers = ImageIO.getImageReaders(input);
        if (!readers.hasNext()) throw invalid();
        var reader = readers.next();
        BufferedImage sampled;
        try {
          reader.setInput(input, true, true);
          int width = reader.getWidth(0), height = reader.getHeight(0);
          if (width < 1 || height < 1 || (long) width * height > 100_000_000L) throw invalid();
          int factor = Math.max(1, Math.max(width, height) / (kind.edge * 2));
          var parameters = reader.getDefaultReadParam();
          parameters.setSourceSubsampling(factor, factor, 0, 0);
          sampled = reader.read(0, parameters);
        } finally { reader.dispose(); }
        int orientation = 1;
        try {
          var exif = ImageMetadataReader.readMetadata(new ByteArrayInputStream(source)).getFirstDirectoryOfType(ExifIFD0Directory.class);
          if (exif != null && exif.containsTag(ExifIFD0Directory.TAG_ORIENTATION)) orientation = exif.getInt(ExifIFD0Directory.TAG_ORIENTATION);
        } catch (Exception ignored) { /* Formats without EXIF keep their pixel orientation. */ }
        BufferedImage oriented = orient(sampled, orientation);
        try {
          double scale = Math.min(1, (double) kind.edge / Math.max(oriented.getWidth(), oriented.getHeight()));
          boolean alpha = oriented.getColorModel().hasAlpha();
          var output = new BufferedImage(Math.max(1, (int) Math.round(oriented.getWidth() * scale)),
              Math.max(1, (int) Math.round(oriented.getHeight() * scale)), alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
          try {
            var graphics = output.createGraphics();
            try {
              graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
              graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
              graphics.drawImage(oriented, 0, 0, output.getWidth(), output.getHeight(), null);
            } finally { graphics.dispose(); }
            var bytes = new ByteArrayOutputStream();
            if (alpha) ImageIO.write(output, "png", bytes);
            else {
              var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
              try (var stream = new MemoryCacheImageOutputStream(bytes)) {
                writer.setOutput(stream);
                var parameters = writer.getDefaultWriteParam();
                parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                parameters.setCompressionQuality(.8f);
                writer.write(null, new IIOImage(output, null, null), parameters);
              } finally { writer.dispose(); }
            }
            return new Encoded(bytes.toByteArray(), alpha ? "image/png" : "image/jpeg");
          } finally { output.flush(); }
        } finally { if (oriented != sampled) oriented.flush(); sampled.flush(); }
      }
    } catch (DomainException error) { throw error; }
    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw busy(); }
    catch (Exception error) { throw invalid(); }
    finally { if (acquired) encoders.release(); }
  }

  private static BufferedImage orient(BufferedImage image, int orientation) {
    if (orientation < 2 || orientation > 8) return image;
    int width = image.getWidth(), height = image.getHeight();
    boolean swap = orientation >= 5;
    var output = new BufferedImage(swap ? height : width, swap ? width : height,
        image.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
    for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
      int dx = x, dy = y;
      switch (orientation) {
        case 2 -> dx = width - 1 - x;
        case 3 -> { dx = width - 1 - x; dy = height - 1 - y; }
        case 4 -> dy = height - 1 - y;
        case 5 -> { dx = y; dy = x; }
        case 6 -> { dx = height - 1 - y; dy = x; }
        case 7 -> { dx = height - 1 - y; dy = width - 1 - x; }
        case 8 -> { dx = y; dy = width - 1 - x; }
        default -> { }
      }
      output.setRGB(dx, dy, image.getRGB(x, y));
    }
    return output;
  }

  static DomainException busy() { return new DomainException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "IMAGE_PREVIEW_BUSY", "图片预览暂时繁忙，请稍后重试"); }
  private static DomainException invalid() { return DomainException.unprocessable("IMAGE_PREVIEW_UNAVAILABLE", "图片暂时无法生成预览"); }
}
