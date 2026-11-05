package com.fengyi.ordershow.storage;

import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.model.ObjectMetadata;
import java.io.InputStream;

final class OssObjectStorage implements ObjectStorage,AutoCloseable {
  private final OSS client;
  OssObjectStorage(OSS client){this.client=client;}
  public String provider(){return "OSS";}
  public void initialize(){} // Cloud buckets are provisioned by operations.
  public void put(String bucket,String key,InputStream input,long length,String type){
    var metadata=new ObjectMetadata();metadata.setContentLength(length);metadata.setContentType(type);
    client.putObject(bucket,key,input,metadata);
  }
  public InputStream read(String bucket,String key){return client.getObject(bucket,key).getObjectContent();}
  public InputStream readIfPresent(String bucket,String key){
    try{return read(bucket,key);}catch(OSSException e){if("NoSuchKey".equals(e.getErrorCode()))return null;throw e;}
  }
  public void copy(String fromBucket,String from,String toBucket,String to){client.copyObject(fromBucket,from,toBucket,to);}
  public boolean copyIfPresent(String fromBucket,String from,String toBucket,String to){
    try{copy(fromBucket,from,toBucket,to);return true;}catch(OSSException e){if("NoSuchKey".equals(e.getErrorCode()))return false;throw e;}
  }
  public void remove(String bucket,String key){client.deleteObject(bucket,key);}
  public void close(){client.shutdown();}
}
