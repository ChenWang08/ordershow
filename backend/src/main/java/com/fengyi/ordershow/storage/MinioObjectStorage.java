package com.fengyi.ordershow.storage;

import com.fengyi.ordershow.config.OrderShowProperties;
import io.minio.*;
import java.io.InputStream;

final class MinioObjectStorage implements ObjectStorage {
  private final MinioClient client;
  private final String bucket;
  private volatile boolean initialized;
  MinioObjectStorage(OrderShowProperties.Storage config) {
    client=MinioClient.builder().endpoint(config.endpoint()).credentials(config.accessKey(),config.secretKey()).build();
    bucket=config.bucket();
  }
  public String provider(){return "S3";}
  public synchronized void initialize()throws Exception {
    if(initialized)return;
    if(!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build()))client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
    initialized=true;
  }
  public void put(String bucket,String key,InputStream input,long length,String type)throws Exception {
    initialize();client.putObject(PutObjectArgs.builder().bucket(bucket).object(key).stream(input,length,-1L).contentType(type).build());
  }
  public InputStream read(String bucket,String key)throws Exception{return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());}
  private static boolean missing(io.minio.errors.ErrorResponseException e){return java.util.Set.of("NoSuchKey","NoSuchObject").contains(e.errorResponse().code());}
  public InputStream readIfPresent(String bucket,String key)throws Exception {
    try{return read(bucket,key);}catch(io.minio.errors.ErrorResponseException e){if(missing(e))return null;throw e;}
  }
  public void copy(String fromBucket,String from,String toBucket,String to)throws Exception {
    initialize();client.copyObject(CopyObjectArgs.builder().bucket(toBucket).object(to)
        .source(SourceObject.builder().bucket(fromBucket).object(from).build()).build());
  }
  public boolean copyIfPresent(String fromBucket,String from,String toBucket,String to)throws Exception {
    try{copy(fromBucket,from,toBucket,to);return true;}catch(io.minio.errors.ErrorResponseException e){if(missing(e))return false;throw e;}
  }
  public void remove(String bucket,String key)throws Exception{client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());}
}
