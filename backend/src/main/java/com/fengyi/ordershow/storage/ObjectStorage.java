package com.fengyi.ordershow.storage;

import java.io.InputStream;

/** Object operations only. File ownership and authorization remain in StorageService. */
public interface ObjectStorage {
  String provider();
  void initialize() throws Exception;
  void put(String bucket, String key, InputStream input, long length, String contentType) throws Exception;
  InputStream read(String bucket, String key) throws Exception;
  InputStream readIfPresent(String bucket, String key) throws Exception;
  void copy(String sourceBucket, String sourceKey, String targetBucket, String targetKey) throws Exception;
  boolean copyIfPresent(String sourceBucket, String sourceKey, String targetBucket, String targetKey) throws Exception;
  void remove(String bucket, String key) throws Exception;
}
