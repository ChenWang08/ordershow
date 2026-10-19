# 阿里云 ACK 部署交付

## 范围与分工

本地 Docker Compose 长期保留（MySQL、Redis、MinIO）；测试与生产用 ACK 运行前后端，连接 PolarDB MySQL 兼容版、阿里云 Redis 和 OSS。正式业务数据重新导入，不复制本地数据库/MinIO 数据。支持人工调整副本，不交付 HPA。

应用侧交付镜像、配置模板、SQL、通用 Kubernetes YAML 和验证记录。运维提供网络、云资源、域名/HTTPS、镜像仓库、真实配置与备份；DBA 审核并执行数据库脚本。没有修改或连接任何生产环境。

## 环境配置

- 本地：继续使用根目录 `.env.example` / `docker-compose.yml`。不配置 profile 时保留原本地行为，也可设置 `SPRING_PROFILES_ACTIVE=local`。
- 切换本地开发目录但复用原数据卷时，必须在新目录的 `.env` 中保留原 `PHONE_HMAC_KEY` 和 `PHONE_ENCRYPTION_KEY`，不能改用默认值；否则已有手机号校验或解密会失败。`.env` 不提交 Git。仅变更后端环境变量时，使用 `docker compose up -d --no-deps --no-build --force-recreate backend` 加载配置；普通 restart 不会加载新的环境变量。此操作会更新原本地后端，须在明确要更新该环境时执行；隔离测试仍使用 ACK smoke 配置。
- ACK 测试：`SPRING_PROFILES_ACTIVE=test`；生产：`prod`。这两个 profile 都包含 `cloud` 配置，关闭 Flyway、历史数据启动迁移、本地演示活动和管理员初始化。
- `config/` 中的示例是变量说明，不是自动加载的配置。ACK 使用 `k8s/configmap.yaml` 和 Secret 注入环境变量；环境间必须分别配置资源和凭证。
- 各副本使用同一组业务密钥。不要在扩容或重启时重新生成密钥；已有加密数据需要原密钥读取。

| 变量 | 用途/要求 | 保存位置 |
| --- | --- | --- |
| SPRING_PROFILES_ACTIVE | test 或 prod | ConfigMap |
| DB_URL | JDBC MySQL URL；PolarDB 主写端点，不使用只读节点；明确时区和 TLS | ConfigMap |
| DB_USERNAME / DB_PASSWORD | 业务账号，仅业务库 DML 权限 | ConfigMap / Secret |
| DB_POOL_SIZE | 每个副本最大连接数，模板 10 | ConfigMap |
| REDIS_HOST / REDIS_PORT | 云 Redis 地址和端口；模板按单入口连接 | ConfigMap |
| REDIS_USERNAME / REDIS_PASSWORD | 按托管 Redis 认证要求填写；无 ACL 用户名可留空 | ConfigMap / Secret |
| REDIS_SSL_ENABLED | 是否启用 TLS；模板 true，须与实例匹配 | ConfigMap |
| STORAGE_PROVIDER | 本地 minio，云端 oss | ConfigMap |
| STORAGE_ENDPOINT / STORAGE_BUCKET | OSS HTTPS 服务端点和预建私有 Bucket | ConfigMap |
| STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY | OSS AK/SK，授予目标 Bucket 对象 GetObject、PutObject 权限 | Secret |
| OSS_REGION | Bucket 地域，例如 cn-hangzhou；使用 V4 签名 | ConfigMap |
| PUBLIC_ORIGIN | 浏览器实际 HTTPS 访问源（协议+域名+可选端口，无路径） | ConfigMap |
| REALTIME_CHANNEL | 每环境不同的 Redis 通道；同环境副本一致 | ConfigMap |
| PHONE_HMAC_KEY / PHONE_ENCRYPTION_KEY | 两个不同的至少 32 字符随机秘密 | Secret |
| HTTP_MAX_THREADS / H5_WRITE_CONCURRENCY | 每副本线程和写入并发限制 | ConfigMap |
| H5_WARMUP_ENABLED | 启动只读预热，默认 true | ConfigMap |
| JAVA_TOOL_OPTIONS | JVM 内存比例等；模板 MaxRAMPercentage=70 | ConfigMap |

本地 `S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET` 继续有效。通用 `STORAGE_*` 优先于旧变量。云端校验缺失值、占位符、短业务密钥及不安全的启动开关；不要通过环境覆盖重新启用 Flyway、演示初始化或非安全 Cookie。

PolarDB 需要支持项目 SQL 使用的 MySQL 8 能力，具体版本须测试。Redis 需要允许 GET/SET/DEL 及 PUBLISH/SUBSCRIBE 等所用命令；当前使用单入口配置，若交付的是需要客户端直连分片的集群模式，应另行配置和验证。TLS 私有 CA 由运维通过 JVM truststore 配置，不关闭证书验证来绕过错误。

## 文件存储与访问方式

`StorageService` 管理数据库文件元信息和业务权限，`ObjectStorage` 选择 MinIO 或 OSS。MinIO 沿用自动创建本地 Bucket；OSS 不创建或修改 Bucket，运维预先建好私有 Bucket。AK/SK 不进入浏览器。

文件仍通过 `/api/v1/public/files/{id}` 由后端读取：商品/奖品图片保持原公开用途；源表等文件仍检查登录及权限。此次不改成公开 Bucket、浏览器直传或签名直链，因此不要求 OSS CORS。现有代码没有物理删除对象操作，本次不新增物理删除/自动清理逻辑；未引用对象的保留和清理策略由运维另行审定。

## 镜像构建与推送

最新本地验证版本为 `20261015.1`，见 [本地镜像与验证记录](local-images-20261015.1.md)。构建本地 ACK 镜像、推送 CODING、更新 ACK 部署是三个独立步骤；本版本已完成本地构建、隔离验证及 CODING 推送，远端摘要已核验；测试环境升级由部署团队执行。隔离配置默认使用该版本，可通过 `ACK_IMAGE_TAG` 选择版本。

下面是 shell 示例，将仓库和版本改为实际值，构建与 ACK 节点一致的架构。使用明确版本标签，测试验收后将同一镜像摘要用于生产。

```sh
docker build -f backend/Dockerfile -t REGISTRY/order-show/backend:VERSION .
docker build -f Dockerfile.frontend --build-arg NEXT_PUBLIC_API_BASE=/api/v1 -t REGISTRY/order-show/frontend:VERSION .
docker push REGISTRY/order-show/backend:VERSION
docker push REGISTRY/order-show/frontend:VERSION
```

**前端的 NEXT_PUBLIC_API_BASE 是构建参数，不是运行时配置。** ACK 镜像固定使用相对路径 `/api/v1`，由 Ingress 同域分流，测试和生产不需要把域名编进镜像。不要把本地默认指向 8080 的前端镜像直接交给 ACK。后端云资源信息均由运行时环境变量注入。

## 数据库准备

当前结构版本为 V039；已有 V038 云库须由 DBA 先执行 `db/migrations/V039__activity_backgrounds.sql` 并记录版本，再更新应用。不得对已有库重跑空库包。

先阅读 [DBA 执行说明](dba/README.md)。运行 `node scripts/package-dba.mjs` 生成空库初始化包，DBA 建库并执行，再创建初始管理员。V037 是 Java 数据清理迁移，此次全新空库明确不适用，已在 manifest 中标记。应用不会自动改表，也不会在云端创建本地演示活动。

## ACK 部署步骤

1. 运维准备独立测试/生产 Namespace、主写数据库端点、Redis、私有 OSS Bucket、AK/SK、镜像拉取权限、域名和 TLS Secret。确认 ACK 到云服务的网络、白名单、DNS 和证书信任。
2. DBA 完成空库初始化和管理员创建。不要在应用的 initContainer 中执行数据库迁移。
3. 将模板复制到私有目录（如已忽略的 `deploy/private/`），填写实际配置。Secret 示例不能原样投入使用；真实值不提交 Git、不输出到聊天。
4. `namespace.yaml` 默认 order-show-test，生产另建 order-show-prod。其他资源以 `kubectl -n` 明确指定 Namespace。填写 apps.yaml 镜像地址、资源配额；私有仓库按集群规范配置 imagePullSecrets 或节点拉取权限。
5. 配置 Ingress class、域名、TLS Secret。路由保留完整 `/api/v1` 前缀，不做重写。控制器需要允许 170 MB 请求体（单文件 150 MB），SSE 关闭缓冲并设置足够的读超时，例如至少 60 秒；这些参数由具体 Nginx/ALB 控制器决定，通用模板不假设控制器。
6. 检查模板后执行（路径指向已填写的私有副本）：

```sh
kubectl apply -f deploy/private/namespace.yaml
kubectl -n order-show-test apply -f deploy/private/configmap.yaml
kubectl -n order-show-test apply -f deploy/private/secret.yaml
kubectl -n order-show-test apply -f deploy/private/apps.yaml
kubectl -n order-show-test apply -f deploy/private/ingress.yaml
kubectl -n order-show-test rollout status deployment/backend
kubectl -n order-show-test rollout status deployment/frontend
```

Secret/ConfigMap 作为环境变量加载，变更后需 `rollout restart deployment/backend`。TLS Secret 由运维事先配置，模板不会申请证书。通用 YAML 不创建数据库、Redis、MinIO/OSS、负载均衡器或 HPA。

## 多副本机制及人工扩缩容

- 会话、权限、CSRF 校验依托数据库；各副本共用业务密钥，不需要粘性会话。
- Outbox 事件通过 Redis 发布，各副本监听同一环境通道，再通知自身 SSE 客户端。消息允许重复；重复通知只触发刷新。Redis 短暂断开可能丢失 Pub/Sub 消息，服务每 15 秒对现有连接发送刷新通知兜底，原前端也有轮询。
- 导入任务通过 `FOR UPDATE SKIP LOCKED` 在同一事务中领取和发布；容器崩溃会回滚领取，其他副本可重新处理。活动级锁串行化同活动发布。对象上传与数据库不是分布式事务，失败可能留下未引用对象，不影响当前已发布数据。
- 定时状态切换使用条件更新并与事件写入处于事务内；幂等记录清理可重复执行。订单和抽奖已有数据库锁/唯一约束，扩容仍须执行并发验收。
- 业务文件在对象存储，预览和任务状态在数据库；请求内临时内存不作为跨请求共享状态。前端镜像携带静态资源，不挂业务数据卷。

```sh
kubectl -n order-show-test scale deployment/backend --replicas=3
kubectl -n order-show-test scale deployment/frontend --replicas=3
```

最大副本数 × DB_POOL_SIZE，加上滚动更新额外副本和 DBA/监控连接，必须低于数据库连接预算。资源模板是起点，不代表生产容量承诺。后端有 45 秒优雅关闭、70 秒终止宽限；SSE 断开后浏览器重连，提交请求仍需依赖幂等机制处理重试。

## 验证、排障与回滚

- 检查 `/api/v1/actuator/health/readiness`（云端含数据库和 Redis），`liveness` 只判断进程状态。OSS 上传/读取必须单独测试，健康检查不证明 OSS 权限可用。
- 检查管理员登录/首次改密、正式数据导入、图片、H5 下单及变更审核、看板、抽奖。至少两副本测试跨副本会话、通知、重复请求和任务发布，再测试重启及手工扩缩容。
- 看日志：`kubectl -n order-show-test logs deployment/backend --all-pods=true --tail=200`；旧版 kubectl 不支持时逐 Pod 查看。看事件：`kubectl -n order-show-test describe pod POD_NAME`。
- ImagePullBackOff 检查仓库权限/标签；配置占位符报错检查 Secret/ConfigMap；SQL 错误先检查 DBA 版本；Redis 失败检查认证/TLS/网络和订阅权限；文件错误检查 Bucket 地域、AK/SK 和对象权限；SSE 延迟检查 Ingress 缓冲/超时。
- 应用回滚：`kubectl -n order-show-test rollout undo deployment/backend`，前端同理；同时恢复对应配置版本并验证。数据库结构不随镜像自动回滚，需 DBA 先确认兼容性。运维负责数据库与 OSS 备份及恢复演练。

实际验证状态见 [验证记录](verification.md)。通用模板无法替代真实 ACK、PolarDB、托管 Redis TLS 和 OSS AK/SK 联调。
