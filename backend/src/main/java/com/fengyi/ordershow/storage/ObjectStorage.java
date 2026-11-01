package com.fengyi.ordershow.storage;

import java.io.InputStream;

/** Object bytes only; database metadata and access control stay in StorageService. */
public interface ObjectStorage {
  String provider();
  void initialize() throws Exception;
  void put(String bucket, String key, byte[] content, String contentType) throws Exception;
  InputStream read(String bucket, String key) throws Exception;
  /** Null only for a missing object; authorization, bucket and network errors still propagate. */
  InputStream readIfPresent(String bucket, String key) throws Exception;
}
