package com.fengyi.ordershow.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.aliyun.oss.OSS;
import com.aliyun.oss.model.OSSObject;
import com.aliyun.oss.model.ObjectMetadata;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OssObjectStorageTest {
  @Test void preservesBinaryContentAndMetadataWithoutBucketAdministration() throws Exception {
    OSS client = mock(OSS.class);
    var storage = new OssObjectStorage(client);
    byte[] bytes = new byte[]{0, 1, -1, 34};
    storage.initialize();
    verifyNoInteractions(client);
    storage.put("bucket", "activity/key.png", bytes, "image/png");
    var input = ArgumentCaptor.forClass(InputStream.class);
    var metadata = ArgumentCaptor.forClass(ObjectMetadata.class);
    verify(client).putObject(eq("bucket"), eq("activity/key.png"), input.capture(), metadata.capture());
    assertThat(input.getValue().readAllBytes()).isEqualTo(bytes);
    assertThat(metadata.getValue().getContentType()).isEqualTo("image/png");
    assertThat(metadata.getValue().getContentLength()).isEqualTo(bytes.length);
    var object = new OSSObject();
    object.setObjectContent(new ByteArrayInputStream(bytes));
    when(client.getObject("bucket", "activity/key.png")).thenReturn(object);
    try (var stream = storage.read("bucket", "activity/key.png")) { assertThat(stream.readAllBytes()).isEqualTo(bytes); }
    storage.close();
    verify(client).shutdown();
  }
  @Test void onlyMissingKeysAllowLazyDerivativeGeneration() {
    OSS client = mock(OSS.class);
    var storage = new OssObjectStorage(client);
    var missing = new com.aliyun.oss.OSSException("missing");
    missing.setErrorCode("NoSuchKey");
    when(client.getObject("bucket", "missing")).thenThrow(missing);
    assertThat(storage.readIfPresent("bucket", "missing")).isNull();
    for (String code : new String[]{"AccessDenied", "NoSuchBucket"}) {
      var denied = new com.aliyun.oss.OSSException(code);
      denied.setErrorCode(code);
      when(client.getObject("bucket", code)).thenThrow(denied);
      assertThatThrownBy(() -> storage.readIfPresent("bucket", code)).isSameAs(denied);
    }
    verify(client, never()).createBucket(anyString());
  }
}
