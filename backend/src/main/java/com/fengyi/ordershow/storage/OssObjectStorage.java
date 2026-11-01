package com.fengyi.ordershow.storage;

import com.aliyun.oss.OSS;
import com.aliyun.oss.model.ObjectMetadata;
import java.io.ByteArrayInputStream;
import java.io.InputStream;

final class OssObjectStorage implements ObjectStorage, AutoCloseable {
  private final OSS client;
  OssObjectStorage(OSS client) { this.client = client; }
  public String provider() { return "OSS"; }
  // Buckets are provisioned by operations. Application only needs GetObject/PutObject.
  public void initialize() {}
  public void put(String bucket, String key, byte[] content, String contentType) {
    var metadata = new ObjectMetadata();
    metadata.setContentLength(content.length);
    metadata.setContentType(contentType);
    client.putObject(bucket, key, new ByteArrayInputStream(content), metadata);
  }
  public InputStream read(String bucket, String key) {
    return client.getObject(bucket, key).getObjectContent();
  }
  public InputStream readIfPresent(String bucket, String key) {
    try { return read(bucket, key); }
    catch (com.aliyun.oss.OSSException error) {
      if ("NoSuchKey".equals(error.getErrorCode())) return null;
      throw error;
    }
  }
  public void close() { client.shutdown(); }
}
