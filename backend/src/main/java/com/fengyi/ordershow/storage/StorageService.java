package com.fengyi.ordershow.storage;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import jakarta.annotation.PostConstruct;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class StorageService {
  private static final Logger log = LoggerFactory.getLogger(StorageService.class);
  private final MinioClient minio;
  private final JdbcTemplate jdbc;
  private final String bucket;

  public StorageService(OrderShowProperties properties, JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    this.bucket = properties.storage().bucket();
    this.minio = MinioClient.builder().endpoint(properties.storage().endpoint())
        .credentials(properties.storage().accessKey(), properties.storage().secretKey()).build();
  }

  @PostConstruct
  void initialize() {
    try {
      ensureBucket();
    } catch (Exception exception) {
      log.warn("Object storage is not ready yet; uploads will retry lazily: {}", exception.getMessage());
    }
  }

  public StoredFile save(long activityId, MultipartFile file, String purpose, Long adminId) {
    try {
      byte[] content = file.getBytes();
      return save(activityId, file.getOriginalFilename(), file.getContentType(), content, purpose, adminId);
    } catch (Exception exception) {
      if (exception instanceof DomainException domain) throw domain;
      throw new DomainException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_WRITE_FAILED", "文件存储暂不可用，请稍后重试");
    }
  }

  public StoredFile save(long activityId, String originalFilename, String contentType, byte[] content,
                         String purpose, Long adminId) throws Exception {
    ensureBucket();
    byte[] sha = MessageDigest.getInstance("SHA-256").digest(content);
    String safeName = originalFilename == null ? "file" : originalFilename.replaceAll("[^A-Za-z0-9._\\-\\u4e00-\\u9fa5]", "_");
    String key = activityId + "/" + purpose.toLowerCase() + "/" + UUID.randomUUID() + "-" + safeName;
    minio.putObject(PutObjectArgs.builder().bucket(bucket).object(key)
        .stream(new ByteArrayInputStream(content), (long) content.length, -1L)
        .contentType(contentType == null ? "application/octet-stream" : contentType).build());
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var statement = connection.prepareStatement("""
          INSERT INTO stored_file(activity_id, storage_provider, bucket_name, object_key, original_filename,
                                  content_type, size_bytes, sha256, file_purpose, reference_count, created_by)
          VALUES (?, 'S3', ?, ?, ?, ?, ?, ?, ?, 1, ?)
          """, java.sql.Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, activityId);
      statement.setString(2, bucket);
      statement.setString(3, key);
      statement.setString(4, originalFilename == null ? "file" : originalFilename);
      statement.setString(5, contentType == null ? "application/octet-stream" : contentType);
      statement.setLong(6, content.length);
      statement.setBytes(7, sha);
      statement.setString(8, purpose);
      if (adminId == null) statement.setNull(9, java.sql.Types.BIGINT); else statement.setLong(9, adminId);
      return statement;
    }, keys);
    long id = keys.getKey().longValue();
    if (List.of("PRODUCT_IMAGE", "LOTTERY_PRIZE_IMAGE", "ACTIVITY_BACKGROUND").contains(purpose)) {
      var meta = new FileMeta(id, bucket, key, originalFilename, contentType, content.length);
      try {
        writeVariant(meta, ImageVariants.Kind.THUMBNAIL, ImageVariants.render(content, ImageVariants.Kind.THUMBNAIL));
        if ("LOTTERY_PRIZE_IMAGE".equals(purpose)) writeVariant(meta, ImageVariants.Kind.DISPLAY, ImageVariants.render(content, ImageVariants.Kind.DISPLAY));
      } catch (DomainException error) {
        // Keep the original upload usable; a derivative failure must not corrupt an import.
        log.warn("Image derivative preparation failed for file {}: {}", id, error.code());
      }
    }
    return new StoredFile(id, activityId, key, originalFilename, contentType, content.length, sha);
  }

  public byte[] read(long fileId) {
    return read(meta(fileId));
  }

  /** Export-only streaming API. The caller reserves metadata before object I/O so deletion can discover the object. */
  public FileMeta prepareExport(long activityId,String filename,long size,byte[] sha,long adminId,String token) {
    String key=activityId+"/export_result/"+token+".zip";
    GeneratedKeyHolder keys=new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var statement=connection.prepareStatement("""
          INSERT INTO stored_file(activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,reference_count,created_by)
          VALUES(?,'S3',?,?,?,'application/zip',?,?,'EXPORT_RESULT',1,?)
          """,java.sql.Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1,activityId);statement.setString(2,bucket);statement.setString(3,key);statement.setString(4,filename);
      statement.setLong(5,size);statement.setBytes(6,sha);statement.setLong(7,adminId);return statement;
    },keys);
    return new FileMeta(keys.getKey().longValue(),bucket,key,filename,"application/zip",size);
  }
  public void uploadExport(FileMeta meta,java.nio.file.Path path)throws Exception {
    ensureBucket();
    try(var input=java.nio.file.Files.newInputStream(path)) {
      minio.putObject(PutObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey())
          .stream(input,meta.sizeBytes(),-1L).contentType("application/zip").build());
    }
  }
  public InputStream openExport(FileMeta meta)throws Exception {
    return minio.getObject(GetObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey()).build());
  }
  public void discardExport(FileMeta meta)throws Exception {
    minio.removeObject(io.minio.RemoveObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey()).build());
    jdbc.update("UPDATE stored_file SET deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)) WHERE id=? AND file_purpose='EXPORT_RESULT'",meta.id());
  }

  public byte[] read(FileMeta meta) {
    try (InputStream input = minio.getObject(GetObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey()).build())) {
      return input.readAllBytes();
    } catch (Exception exception) {
      throw DomainException.notFound("FILE_NOT_AVAILABLE", "文件不存在或暂不可读取");
    }
  }

  public ImageVariants.Encoded readVariant(FileMeta meta, ImageVariants.Kind kind) {
    try (var input = minio.getObject(GetObjectArgs.builder().bucket(meta.bucket()).object(variantObjectKey(meta, kind)).build())) {
      return new ImageVariants.Encoded(input.readAllBytes(), input.headers().get("Content-Type"));
    } catch (io.minio.errors.ErrorResponseException error) {
      if (List.of("NoSuchKey", "NoSuchObject").contains(error.errorResponse().code())) return null;
      throw ImageVariants.busy();
    } catch (Exception error) { throw ImageVariants.busy(); }
  }

  @org.springframework.transaction.annotation.Transactional
  public void writeVariant(FileMeta meta, ImageVariants.Kind kind, ImageVariants.Encoded image) {
    var available = jdbc.queryForList("""
        SELECT a.id FROM activity a JOIN stored_file f ON f.activity_id=a.id
        WHERE f.id=? AND f.deleted_at IS NULL AND a.deletion_requested_at IS NULL FOR SHARE
        """, Long.class, meta.id());
    if (available.isEmpty()) throw DomainException.notFound("FILE_NOT_FOUND", "图片不存在或活动已删除");
    try {
      minio.putObject(PutObjectArgs.builder().bucket(meta.bucket()).object(variantObjectKey(meta, kind))
          .stream(new ByteArrayInputStream(image.bytes()), (long) image.bytes().length, -1L).contentType(image.contentType()).build());
    } catch (Exception error) { throw ImageVariants.busy(); }
  }

  /** Idempotent object removal. The durable deletion manifest survives missing metadata. */
  public void removeWithVariants(FileMeta meta) {
    try {
      for (var kind : ImageVariants.Kind.values()) minio.removeObject(io.minio.RemoveObjectArgs.builder()
          .bucket(meta.bucket()).object(variantObjectKey(meta,kind)).build());
      minio.removeObject(io.minio.RemoveObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey()).build());
    } catch (Exception error) { throw new IllegalStateException("文件清理失败",error); }
  }

  // MinIO can reject path segments over 255 bytes; long source filenames need a short derivative name.
  static String variantObjectKey(FileMeta meta, ImageVariants.Kind kind) {
    String key = meta.objectKey() + kind.key();
    int slash = key.lastIndexOf('/');
    if (key.substring(slash + 1).getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 255) return key;
    try {
      String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(meta.objectKey().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      return key.substring(0, slash + 1) + digest + kind.key();
    } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  public FileMeta meta(long fileId) {
    List<FileMeta> rows = jdbc.query("""
        SELECT id, bucket_name, object_key, original_filename, content_type, size_bytes
        FROM stored_file WHERE id = ? AND deleted_at IS NULL
        """, (rs, rowNum) -> new FileMeta(rs.getLong("id"), rs.getString("bucket_name"), rs.getString("object_key"),
        rs.getString("original_filename"), rs.getString("content_type"), rs.getLong("size_bytes")), fileId);
    if (rows.size() != 1) throw DomainException.notFound("FILE_NOT_FOUND", "文件不存在");
    return rows.getFirst();
  }

  private synchronized void ensureBucket() throws Exception {
    if (!minio.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
      minio.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
    }
  }

  public record StoredFile(long id, long activityId, String objectKey, String originalFilename,
                           String contentType, long sizeBytes, byte[] sha256) {}
  public record FileMeta(long id, String bucket, String objectKey, String filename, String contentType, long sizeBytes) {}
}
