package com.fengyi.ordershow.storage;

import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.ClientBuilderConfiguration;
import com.aliyun.oss.common.auth.DefaultCredentialProvider;
import com.aliyun.oss.common.comm.SignVersion;
import com.fengyi.ordershow.config.OrderShowProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StorageConfiguration {
  @Bean
  ObjectStorage objectStorage(OrderShowProperties properties,
      @Value("${STORAGE_PROVIDER:minio}") String provider,
      @Value("${OSS_REGION:}") String region) {
    var config = properties.storage();
    return switch (provider) {
      case "minio" -> new MinioObjectStorage(config);
      case "oss" -> {
        if (region.isBlank()) throw new IllegalArgumentException("OSS_REGION is required for OSS");
        var clientConfig = new ClientBuilderConfiguration();
        clientConfig.setSignatureVersion(SignVersion.V4);
        clientConfig.setConnectionTimeout(5000);
        clientConfig.setSocketTimeout(30000);
        yield new OssObjectStorage(OSSClientBuilder.create().endpoint(config.endpoint())
            .credentialsProvider(new DefaultCredentialProvider(config.accessKey(), config.secretKey()))
            .clientConfiguration(clientConfig).region(region).build());
      }
      default -> throw new IllegalArgumentException("STORAGE_PROVIDER must be minio or oss");
    };
  }
}
