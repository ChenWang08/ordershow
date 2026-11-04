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
  @Bean public ObjectStorage objectStorage(OrderShowProperties properties,@Value("${STORAGE_PROVIDER:minio}") String provider,@Value("${OSS_REGION:}") String region){
    var config=properties.storage();
    if("minio".equals(provider))return new MinioObjectStorage(config);
    if(!"oss".equals(provider))throw new IllegalArgumentException("STORAGE_PROVIDER must be minio or oss");
    if(region.isBlank())throw new IllegalArgumentException("OSS_REGION is required for OSS");
    var options=new ClientBuilderConfiguration();options.setSignatureVersion(SignVersion.V4);
    options.setConnectionTimeout(5000);options.setSocketTimeout(30000);options.setMaxConnections(8);
    return new OssObjectStorage(OSSClientBuilder.create().endpoint(config.endpoint())
        .credentialsProvider(new DefaultCredentialProvider(config.accessKey(),config.secretKey()))
        .clientConfiguration(options).region(region).build());
  }
}
