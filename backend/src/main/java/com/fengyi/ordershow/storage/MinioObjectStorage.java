package com.fengyi.ordershow.storage;

import com.fengyi.ordershow.config.OrderShowProperties;
import io.minio.*;
import java.io.ByteArrayInputStream;
import java.io.InputStream;

final class MinioObjectStorage implements ObjectStorage {
  private final MinioClient client;
  private final String bucket;
  private volatile boolean initialized;

  MinioObjectStorage(OrderShowProperties.Storage config) {
    client = MinioClient.builder().endpoint(config.endpoint())
        .credentials(config.accessKey(), config.secretKey()).build();
    bucket = config.bucket();
  }
  public String provider() { return "S3"; } // Preserve existing local metadata.
  public synchronized void initialize() throws Exception {
    if (initialized) return;
    if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
      client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
    }
    initialized = true;
  }
  public void put(String bucket, String key, byte[] content, String contentType) throws Exception {
    initialize();
    client.putObject(PutObjectArgs.builder().bucket(bucket).object(key)
        .stream(new ByteArrayInputStream(content), (long) content.length, -1L).contentType(contentType).build());
  }
  public InputStream read(String bucket, String key) throws Exception {
    return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());
  }
}
