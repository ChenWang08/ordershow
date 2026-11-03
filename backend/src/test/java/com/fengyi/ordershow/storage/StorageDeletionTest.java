package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.config.OrderShowProperties;
import io.minio.MinioClient;
import io.minio.RemoveObjectArgs;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class StorageDeletionTest {
  StorageService storage(MinioClient client){
    var properties=new OrderShowProperties("http://localhost",false,8,12,"unused","unused","test","unused","test",
        new OrderShowProperties.Storage("http://127.0.0.1:39999","test-only","test-only-secret","test"));
    var storage=new StorageService(properties,mock(JdbcTemplate.class));
    ReflectionTestUtils.setField(storage,"minio",client);return storage;
  }
  @Test void removesOriginalAndEveryDerivativeIncludingLongFilenameKeys()throws Exception{
    var client=mock(MinioClient.class);var storage=storage(client);
    var meta=new StorageService.FileMeta(1,"test","1/images/"+"图".repeat(100)+".png","image.png","image/png",1);
    storage.removeWithVariants(meta);storage.removeWithVariants(meta);
    var args=ArgumentCaptor.forClass(RemoveObjectArgs.class);verify(client,times(6)).removeObject(args.capture());
    assertThat(args.getAllValues()).allMatch(arg->arg.bucket().equals("test"));
    assertThat(args.getAllValues().stream().map(RemoveObjectArgs::object).toList()).containsExactlyElementsOf(List.of(
        StorageService.variantObjectKey(meta,ImageVariants.Kind.THUMBNAIL),StorageService.variantObjectKey(meta,ImageVariants.Kind.DISPLAY),meta.objectKey(),
        StorageService.variantObjectKey(meta,ImageVariants.Kind.THUMBNAIL),StorageService.variantObjectKey(meta,ImageVariants.Kind.DISPLAY),meta.objectKey()));
  }
  @Test void propagatesObjectFailureForDurableRetry()throws Exception{
    var client=mock(MinioClient.class);doThrow(new IllegalStateException("unavailable")).when(client).removeObject(any(RemoveObjectArgs.class));
    assertThatThrownBy(()->storage(client).removeWithVariants(new StorageService.FileMeta(1,"test","test.png","test.png","image/png",1)))
        .isInstanceOf(IllegalStateException.class).hasMessage("文件清理失败");
  }
}
