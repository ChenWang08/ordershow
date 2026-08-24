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
    return new StoredFile(id, activityId, key, originalFilename, contentType, content.length, sha);
  }

  public byte[] read(long fileId) {
    FileMeta meta = meta(fileId);
    try (InputStream input = minio.getObject(GetObjectArgs.builder().bucket(meta.bucket()).object(meta.objectKey()).build())) {
      return input.readAllBytes();
    } catch (Exception exception) {
      throw DomainException.notFound("FILE_NOT_AVAILABLE", "文件不存在或暂不可读取");
    }
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
