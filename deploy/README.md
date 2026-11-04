# 阿里云 ACK 部署交付

## ACK 参数调整：2026-11-04

按本次指定的后端 4 副本配置，ACK 模板改为每副本数据库连接池最大 20、最小空闲 2，后端资源上限为 2 CPU / 4Gi；前端模板仍为 2 副本。4 个后端的常态连接上限为 80，滚动更新同时运行 5 个后端时按 100 预算，另为终止中的 Pod、DBA、监控及其他应用留余量。实际后端副本数、数据库额度及性能收益尚待部署团队核实，不代表已修改 ACK。

现有环境仅更新连接池参数时，使用 [参数补丁及操作说明](changes/20261104-db-pool-20/README.md)，保留运行中的镜像、资源、地址和密钥。ConfigMap 变更后须滚动重启后端。应用 cloud profile 未注入变量时仍回退到 10；ACK 通过 ConfigMap 显式注入 20。隔离双副本 smoke 栈仍保留原来的 10，不将历史测试视为本次 4 副本 / 20 连接通过。

## 本轮本地镜像完成：20261102.1

已合入 main `8f73326`，保留 ACK 的 OSS/MinIO、多副本和云端配置。前后端 `20261102.1` 已在本机构建，镜像源码为 `4382bf6`，平台 linux/amd64、非 root，前端使用同域 `/api/v1`。前端相关 53 项、后端相关 15 项、类型检查、图片组件浏览器及最终镜像双副本小场景均通过；确认缩略图共享、缓存复用、304、同源预检为 0。仅做相关验证，未重跑全量回归、压测或数据库升级演练。结构仍 V049，无新增 SQL。隔离环境已清理，原日常六容器、.env 和旧 ACK 镜像未变。新镜像仅在本地，未上传或部署 ACK；详细身份、范围及真实云端待验项见 [本轮交付记录](local-images-20261102.1.md)。


## 历史已上传镜像：20261101.2

本轮合入 main `541bcd7`：活动资料改为普通 HTTP JSON、ETag/304 和可见时约 30 秒轻量检查，新前端不使用活动 SSE；统计仍按需加载。用户指定的两个本地 ACK 20261101.2 镜像已推送 CODING，远端摘要与本地一致，平台 linux/amd64，详见[推送记录](local-images-20261101.2.md)。本次仅核验身份与推送，未重新构建或重跑隔离测试，未部署 ACK。结构仍 V049，没有新增数据库迁移。

### 本轮本地验收补充

本轮本地构建与隔离验证完成：前端 386 项通过，后端 269 通过/119 条件跳过；双副本 HTTP/304、截止重开、五类页面与每分钟 300 新单加 20 单集中提交通过，920 单全部成功、对账差异 0。源码提交 72e3038，详见 [本地验收记录](local-images-20261101.2.md)。

收尾时发现同目录另有上传交付记录。本任务只进行了本地构建和验证，没有执行 CODING 上传；只读查询确认 CODING 同名 20261101.2 前后端镜像已存在，摘要分别为后端 sha256:1a92e7d6033e9e33af0818187d0ad7769050655319668fd238ce61ced48c9470、前端 sha256:faa6b1def69821935e852f8bf447a23a2afd514a75d9dc1a7d572cf7589255b2，与本轮镜像一致。上传属于本任务以外的操作；本任务未部署 ACK。

## 历史交付：20261101.1

已完整合入 main `e3cacc3`（业务源码 `080493a`）及其分支历史；ACK 源码提交 `1e71552`，结构 V049。前后端本地镜像 `20261101.1` 已构建及隔离双副本验收，均已推送 CODING 并核验远端摘要与本地一致；未部署 ACK，日常本地服务未变。平台 linux/amd64、非 root、前端相对 API `/api/v1`；镜像 ID、测试结果、升级及云端待验范围见 [本轮记录](local-images-20261101.1.md)。旧 `20261030.1` 镜像保留。

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
| DB_POOL_SIZE | 每个后端副本最大连接数，ACK 模板 20 | ConfigMap |
| DB_POOL_MIN_IDLE | 每个副本最小空闲连接，模板 2 | ConfigMap |
| H5_SESSION_CACHE_TTL_MS | ACK 固定建议 0；避免单副本身份缓存延迟感知跨副本撤销 | ConfigMap |
| DASHBOARD_SUMMARY_ENABLED | 本版模板 true；已有库先升 V049、逐活动 repair/check，再启用 | ConfigMap |
| DASHBOARD_SUMMARY_ACTIVITIES | 空值表示所有活动；仅限制读取，不限制汇总维护 | ConfigMap |
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

## 当前活动资料 HTTP 与资源配置（20261101.2）

活动资料使用 `GET /api/v1/public/activities/{code}`，首次完整 JSON，未变化返回空正文 304；页面可见时每 27～33 秒检查，隐藏暂停、恢复立即检查，10 秒超时、失败保留旧资料并提供重试。新前端不连接活动 SSE；旧 `/events` 暂留旧客户端兼容。排行进入只读选项，确认后查询，统计不随活动资料检查重查。新活动资料通道不依赖 SSE 代理配置；真实公网 JSON/304 转发仍须部署后检查。

`ACTIVITY_INFO_CHANNEL`、`H5_CATALOG_CHANNEL` 默认分别从 `REALTIME_CHANNEL` 派生后缀 `:activity-info:v1`、`:product-catalog:v1`；测试/生产模板显式分开，同环境副本必须一致。Redis Pub/Sub 不受数据库编号隔离，不能用 Redis DB 编号代替通道隔离。

ConfigMap 与 test/prod 模板显式交付：活动心跳 30000ms、每副本最多 2000 个连接；商品缓存 32 活动/估算 32MiB/600 秒空闲淘汰、每副本 4 加载/128 等待者/5000ms 等待；抽奖试算并发 2、开奖并发 1、单查询 8 秒。这些并发限制分别按副本生效，需要与每副本 20 个数据库连接及滚动额外副本一起预算。H5 会话缓存继续为 0，汇总继续开启；真实密钥仍使用 Secret。

活动 HTTP 参数已在 ConfigMap、test/prod 模板中交付：版本短缓存 2000ms、64 活动、最多 2 个数据库加载、128 个读取者、等待 3000ms；完整资料按共享数据库版本和时间派生状态缓存，同活动并发读取合并。等待不持有数据库事务；每副本连接池显式配置为 20，预算计入滚动额外副本。短缓存降低数据库读取，不能替代公网访问验证。

## 文件存储与访问方式

`StorageService` 管理数据库文件元信息和业务权限，`ObjectStorage` 选择 MinIO 或 OSS。MinIO 沿用自动创建本地 Bucket；OSS 不创建或修改 Bucket，运维预先建好私有 Bucket。AK/SK 不进入浏览器。

文件仍通过 `/api/v1/public/files/{id}` 由后端读取：商品/奖品图片保持原公开用途；源表等文件仍检查登录及权限。此次不改成公开 Bucket、浏览器直传或签名直链，因此不要求 OSS CORS。现有代码没有物理删除对象操作，本次不新增物理删除/自动清理逻辑；未引用对象的保留和清理策略由运维另行审定。

## 镜像构建与推送

历史 20261030.1 交付标签为 `20261030.1`，同步 main 至 `9b8df44`（业务源码基线 `d36cbca`），包含看板汇总、草稿并发、订单写入及旧请求重试修复。保留 ACK 云配置和多副本适配，详细验收状态见 [本轮记录](local-images-20261030.1.md)。CODING 前后端均已推送并核验，远端摘要与本地一致，平台 linux/amd64；后端曾因连接中断失败，随后重试成功。未推送 Git、未部署云端；不覆盖日常本地镜像。旧 `20261029.3` 已推送的历史记录见 [上轮记录](local-images-20261029.3.md)。旧标签保留不等于可在新数据上直接回滚。

20261027.1 无新增数据库结构迁移。已有活动的 20/20 上限与 FINISHED 历史快照不会随镜像自动修正；由 DBA 按[排行部署说明](../docs/deployment/2026-10-27-ranking-limits.md)审核目标环境名单再处理，保留自定义值，ARCHIVED 不自动处理。原本地数据与修正名单不能照搬到云端。

下面是 shell 示例，将仓库和版本改为实际值，构建与 ACK 节点一致的架构。使用明确版本标签，测试验收后将同一镜像摘要用于生产。

```sh
docker build -f backend/Dockerfile -t REGISTRY/order-show/backend:VERSION .
docker build -f Dockerfile.frontend --build-arg NEXT_PUBLIC_API_BASE=/api/v1 -t REGISTRY/order-show/frontend:VERSION .
docker push REGISTRY/order-show/backend:VERSION
docker push REGISTRY/order-show/frontend:VERSION
```

**前端的 NEXT_PUBLIC_API_BASE 是构建参数，不是运行时配置。** ACK 镜像固定使用相对路径 `/api/v1`，由 Ingress 同域分流，测试和生产不需要把域名编进镜像。不要把本地默认指向 8080 的前端镜像直接交给 ACK。后端云资源信息均由运行时环境变量注入。

## UTC 时间升级注意事项

20261019.1 无新增表结构迁移，但统一应用连接和 DATETIME 读写为 UTC，页面显示北京时间。不得覆盖 Hikari UTC 初始化或把连接时区改为北京时间。已有云端历史时间须由 DBA 单独核查，不自动减 8 小时，也不得套用原本地修正清单。发布时安排受控切换，避免新旧后端同时写入不同口径。详见 [UTC 部署说明](../docs/deployment/2026-10-19-utc-time.md)。

## 数据库准备

当前交付结构版本为 V049。已有 V041 库使用 `deploy/dba/generated/upgrade-v041-v049.sql`；已有 V039 库先执行 V039→V041，再执行 V041→V049。必须先核对目标版本、停写、备份，由 DBA 顺序执行，遇错即停。空库使用最新 fresh-install.sql。所有升级路径均在最终达到 V049 后，逐活动检查汇总，需要时 repair，最后 check 差异为 0，再启用新应用与汇总读取。已有 V038 库先按历史步骤升至 V039。不得对已有库重跑空库包，迁移和回填不在应用启动时执行。

先阅读 [DBA 执行说明](dba/README.md)。运行 `node scripts/package-dba.mjs` 生成空库初始化包，DBA 建库并执行，再创建初始管理员。V037 是 Java 数据清理迁移，此次全新空库明确不适用，已在 manifest 中标记。应用不会自动改表，也不会在云端创建本地演示活动。

## 本轮更新顺序

目标库须已达到 V049。先更新全部后端副本并确认普通 GET 200/304，再更新前端并重新打开旧页面；新 HTTP 前端不能配旧的 GET 404 后端。本轮不增加 SQL，也不重新执行已有升级包。

## ACK 部署步骤

1. 运维准备独立测试/生产 Namespace、主写数据库端点、Redis、私有 OSS Bucket、AK/SK、镜像拉取权限、域名和 TLS Secret。确认 ACK 到云服务的网络、白名单、DNS 和证书信任。
2. DBA 完成空库初始化和管理员创建。不要在应用的 initContainer 中执行数据库迁移。
3. 将模板复制到私有目录（如已忽略的 `deploy/private/`），填写实际配置。Secret 示例不能原样投入使用；真实值不提交 Git、不输出到聊天。
4. `namespace.yaml` 默认 order-show-test，生产另建 order-show-prod。其他资源以 `kubectl -n` 明确指定 Namespace。填写 apps.yaml 镜像地址、资源配额；私有仓库按集群规范配置 imagePullSecrets 或节点拉取权限。
5. 配置 Ingress class、域名、TLS Secret。路由保留完整 `/api/v1` 前缀，不做重写。控制器需要允许 170 MB 请求体（单文件 150 MB），SSE 关闭缓冲并设置足够的读超时，例如至少 90 秒；这些参数由具体 Nginx/ALB 控制器决定，通用模板不假设控制器。
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
- ACK 的 H5 身份缓存 TTL 为 0，每次请求校验共享数据库；与保持开启的看板汇总完全独立。ACK 模板使用每后端副本 20 个连接，4 副本常态上限 80、滚动同时运行 5 副本时按 100 预算，另为终止中的 Pod、维护工具（每进程 2）、监控及其他应用留余量；本地单副本默认 60 保留。
- Outbox 事件通过 Redis 发布，各副本监听同一环境通道，再通知自身 SSE 客户端。发布器保留 READ COMMITTED 事务及 FOR UPDATE SKIP LOCKED 领取、发送后确认、失败回滚重试，故障窗口允许重复通知。服务端15秒 RECOVERY 补偿及抽奖等实时功能保留。自20261029.2起，订单看板、订货排行、专题战报不订阅统计 SSE，也不做15秒统计轮询或重连补拉：首次读取后仅手动刷新。活动元数据使用普通 HTTP 和可见时约 30 秒条件检查，未变化返回 304。旧浏览器页面需重新加载才能使用新行为，不能仅更新后端就认定自动查询已停止。
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
- 本版同时包含 V048 独立第一档价格与订单历史写时复制：当前版本的历史明细可能尚未实体化。新版本产生写入后，不能直接换回旧后端或执行 rollout undo；旧程序可能无法正确读取这些历史。回退须停写，由 DBA 评估历史补齐/经验证的兼容回退，或经业务确认恢复升级前备份（升级后数据会丢失，须另行处理）。数据库结构不随镜像自动回滚。

实际验证状态见 [验证记录](verification.md)。通用模板无法替代真实 ACK、PolarDB、托管 Redis TLS 和 OSS AK/SK 联调。
