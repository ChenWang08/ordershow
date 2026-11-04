package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSException;
import com.fengyi.ordershow.config.OrderShowProperties;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class StorageCopyTest {
  @Test void copiesOriginalAndExistingDerivativesWithoutDownloadingOrEncoding()throws Exception{
    var objects=mock(ObjectStorage.class);var properties=new OrderShowProperties("",false,8,12,"","","","","",new OrderShowProperties.Storage("","","","target"));
    var service=new StorageService(properties,mock(JdbcTemplate.class),objects);
    var from=new StorageService.FileMeta(1,"source","1/images/"+"图".repeat(100),"a.png","image/png",100);
    var to=new StorageService.FileMeta(2,"target","2/images/copy-1","a.png","image/png",100);
    service.copyImage(from,to);
    verify(objects).copy("source",from.objectKey(),"target",to.objectKey());
    for(var kind:ImageVariants.Kind.values())verify(objects).copyIfPresent("source",StorageService.variantObjectKey(from,kind),"target",StorageService.variantObjectKey(to,kind));
    verifyNoMoreInteractions(objects);
  }
  @Test void ossUsesNativeCopyAndOnlyMissingObjectsAreOptional(){
    var client=mock(OSS.class);var objects=new OssObjectStorage(client);
    objects.copy("bucket","old","bucket","new");verify(client).copyObject("bucket","old","bucket","new");
    var missing=mock(OSSException.class);when(missing.getErrorCode()).thenReturn("NoSuchKey");
    when(client.copyObject("bucket","missing","bucket","new")).thenThrow(missing);
    assertThat(objects.copyIfPresent("bucket","missing","bucket","new")).isFalse();
    var denied=mock(OSSException.class);when(denied.getErrorCode()).thenReturn("AccessDenied");
    when(client.copyObject("bucket","denied","bucket","new")).thenThrow(denied);
    assertThatThrownBy(()->objects.copyIfPresent("bucket","denied","bucket","new")).isSameAs(denied);
    verify(client,never()).getObject(anyString(),anyString());verify(client,never()).createBucket(anyString());
  }
  @Test void activeCopyProtectsSourceImagesFromDeletion(){
    var objects=mock(ObjectStorage.class);var jdbc=mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(),eq(Boolean.class),eq(1L))).thenReturn(true);
    var properties=new OrderShowProperties("",false,8,12,"","","","","",new OrderShowProperties.Storage("","","","bucket"));
    assertThatThrownBy(()->new StorageService(properties,jdbc,objects).removeWithVariants(new StorageService.FileMeta(1,"bucket","old","a","image/png",1)))
        .hasMessageContaining("正在被活动配置复用");verifyNoInteractions(objects);
  }
  @Test void exportUploadAndDownloadKeepStreamingThroughTheStoragePort(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory)throws Exception{
    var objects=mock(ObjectStorage.class);var jdbc=mock(JdbcTemplate.class);
    var properties=new OrderShowProperties("",false,8,12,"","","","","",new OrderShowProperties.Storage("","","","bucket"));
    var service=new StorageService(properties,jdbc,objects);
    var meta=new StorageService.FileMeta(5,"bucket","5/export_result/test.zip","test.zip","application/zip",3);
    var file=directory.resolve("test.zip");java.nio.file.Files.write(file,new byte[]{1,2,3});
    doAnswer(call->{assertThat(((java.io.InputStream)call.getArgument(2)).readAllBytes()).containsExactly(1,2,3);return null;})
        .when(objects).put(eq("bucket"),eq(meta.objectKey()),any(java.io.InputStream.class),eq(3L),eq("application/zip"));
    service.uploadExport(meta,file);
    var stream=new java.io.ByteArrayInputStream(new byte[]{1,2,3});when(objects.read("bucket",meta.objectKey())).thenReturn(stream);
    assertThat(service.openExport(meta)).isSameAs(stream);service.discardExport(meta);
    verify(objects).remove("bucket",meta.objectKey());verify(jdbc).update(anyString(),eq(5L));
  }
}
