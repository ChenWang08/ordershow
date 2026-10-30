# ACK 适配验证与交付记录

## 最新验证：20261029.3

使用干净运行基础镜像按标准Dockerfile重新构建，业务代码及依赖清单不变。后端627.5MB、前端1,309.6MB；新旧后端BOOT-INF内441个文件逐字节一致。后端167项通过、45条件跳过；双副本、96项手动新增、117项事件/统计API及201项大订单检查通过。三个真实页面静置174.357秒无统计请求增量，手动刷新各增加一次并显示最新数据。cloud profile启动与readiness正常，未访问真实云资源。

2026-10-29 21:24:33（北京时间）隔离环境清理完成，原五个业务容器不变。旧20261029.2保留。随后已按授权推送20261029.3前后端至CODING，两次push均退出码0，远端摘要与本地一致，平台linux/amd64；未部署云端，没有容量压测结论。详见[20261029.3记录](local-images-20261029.3.md)。

## 历史验证：20261029.2

仅合入 main 74e5b8d 和 ac92fc6，未提交的主项目修改不在本次交付范围。前端272项通过；后端167通过、45条件跳过，另外17项真实数据库专项通过、1项批次实验未启用。双副本、91项手动新增、117项事件/统计API、201项大订单接口检查通过。三个实际页面静置146.015秒无统计请求增量，点击后各请求一次并显示新订单。最终前后端镜像均已核对；原业务容器未变，隔离环境已清理，未推送或部署云端。详见[20261029.2记录](local-images-20261029.2.md)。

## 历史验证：20261029.1

20261029.1 前后端镜像构建与隔离验证完成，未推送 CODING、未推送 Git、未部署云端。已合入 main dc4b76c，补齐 ACK 周期刷新协调及多副本事件事务领取。前端 266 项通过；后端默认 204 项中 162 通过、42 条件跳过，另 15 项真实 MySQL 回归及大数据逐字段对照通过。最终镜像双副本验证、95 项手动新增断言、117 项大屏 API 检查通过；两个副本各 10 个连接，原业务容器未变，隔离环境已清理。详见[本次记录](local-images-20261029.1.md)。

## 历史验证：2026-10-27

main 34d73b1 的两项提交已合入 ACK，20261027.1 前后端镜像构建与隔离验证通过；已推送 CODING 并核验远端摘要与 linux/amd64 平台，未部署 ACK。前端 252 项测试、类型和规范检查通过；后端 198 项中 162 通过、36 条件跳过，另真实 MySQL 榜单 10 项全部通过。项目组筛选浏览器检查、双副本、UTC 和手动新增 91 项断言通过。结构仍为 V039，已有活动配置与历史快照需 DBA 按目标环境审核；真实云资源验收待完成。详见[本次记录](local-images-20261027.1.md)。

## 历史验证：2026-10-19

main 0825de6 的三个修复已合入 ACK，镜像 20261019.1 构建及隔离验证通过；前后端均已推送 CODING，远端摘要与本地一致，平台 linux/amd64；测试环境升级及验收待部署团队反馈。前端 223 项测试、类型/规范检查通过；后端 192 项中 161 通过、31 条件跳过。UTC 不同时区验证、手动新增 91 项接口状态断言及双副本验证通过。结构仍为 V039，真实云环境及历史时间核查待完成。详见 [本次记录](local-images-20261019.1.md)。下文保留历史结果。


日期：2026-10-12（Asia/Shanghai）。工作树：`E:\fengyi\order_show-ack`；分支：`codex/ack-cloud-adaptation`。已同步主分支文档提交 `9539610 docs: sync latest features and deployment verification`。原项目业务容器和数据未修改，未部署云端。

## 代码及交付内容

| 文件/目录 | 用途 |
| --- | --- |
| backend/.../storage/ObjectStorage.java、MinioObjectStorage.java、OssObjectStorage.java、StorageConfiguration.java | MinIO/OSS 双实现，OSS AK/SK、V4 签名、对象读写 |
| backend/.../storage/StorageService.java | 复用业务元信息、权限入口，保存实际存储类型 |
| application.yml、application-cloud.yml、CloudConfigurationGuard.java | 本地/test/prod 环境，Redis 认证/TLS，云端必填与启动开关保护 |
| BootstrapData、PhonePlaintextMigration、PriceBackfillRunner | 云端禁用演示初始化和历史数据自动修改 |
| RealtimeConfiguration、RealtimeEventService | Redis 跨副本广播、15 秒刷新兜底、SSE 关闭 |
| ImportService、ImportPublisher、ActivityService | 事务领取导入任务、活动级发布锁、定时状态与事件事务 |
| Dockerfile.frontend、.dockerignore、.env.example、docker-compose.yml | 非 root 前端、忽略秘密文件、本地存储配置兼容 |
| deploy/k8s/ | 8 个标准资源，无中间件、无 HPA |
| scripts/package-dba.mjs、deploy/dba/ | 空库 SQL、来源校验和、初始管理员和 DBA 流程 |
| BootstrapPasswordHash.java | 离线交互生成 BCrypt 哈希，不启动 Spring、不连接 DB |
| deploy/config/ | 本地、测试、生产环境变量模板 |
| scripts/test-ack-replicas.mjs、deploy/verify/ | 固定隔离的双副本验证栈和脚本 |
| README.md、PROJECT.md、AGENTS.md、deploy/README.md | 更新部署边界和后续开发约定 |

## 已完成的验证

- 后端完整编译/测试/打包成功：170 项测试，141 项执行通过，29 项条件集成测试跳过，0 失败、0 错误。跳过项依赖既有专用负载/集成环境，不能记作通过。
- 新增 OSS 字节和 Content-Type/长度传递、无需 Bucket 管理权限、关闭 SDK 客户端的测试。
- 新增跨副本事件分发、Redis 发布失败重试、刷新兜底，以及云端配置拒绝默认值/自动迁移的测试。
- 前端 Docker 构建成功，非 root 容器启动成功，`/admin` 返回 HTTP 200。ACK 镜像编译固定相对 API 地址 `/api/v1`。
- 原本地 Compose 和已有隔离测试 Compose 配置校验通过。
- `kubeconform v0.6.7 -strict -summary deploy/k8s`：5 个文件、8 个资源全部有效，0 错误。未执行真实集群 server-side dry-run。
- DBA 生成的完整空库 SQL 已在独立 MySQL 8.4 中执行成功；记录 V038，未创建 Flyway 历史表，应用在关闭自动迁移时启动成功。
- 双后端实测：A 登录、B 读取会话与执行 CSRF 写操作；A 上传源表、B 读取字节一致；未登录读取源表返回 401。
- 双后端定时执行器竞争同一导入任务，任务完成且仅产生一个发布版本。
- 向共享数据库写入 Outbox 后，两个副本通过真实 Redis 订阅收到同一通知。
- 重启 B 后，原会话仍可在 B 使用。
- test/cloud profile 在临时 MySQL、带密码 Redis 和假 OSS 参数下启动、readiness=UP；此项只证明配置及 SDK 初始化路径，不证明 OSS 可访问。

## 历史验证：2026-10-15

main `65eacb7` 已合入 ACK，新本地镜像版本为 `20261015.1`。前端 203 项测试、类型与规范检查，以及双副本隔离验证通过；后端 190 项测试中 160 通过、30 按环境跳过。DBA 空库包已更新至 V039。前后端均已推送 CODING 并核验远端摘要与 linux/amd64 平台；本次新版本测试环境部署及验收待部署团队反馈。详见 [本地镜像记录](local-images-20261015.1.md)。其余章节保留历史验证结果。

## 镜像（2026-10-12 历史记录）

更新：2026-10-12 再次按 `linux/amd64` 构建，完成隔离验证。用户换网后，前后端 `20261012.1` 均已推送到指定 CODING 仓库，并核验远端摘要与平台。完整地址、摘要和历史网络故障记录见 [20261012.1 交付记录](publish-20261012.1.md)。尚未部署真实 ACK。以下为初次构建时的历史记录。

本机 Docker 已构建独立标签，不覆盖原业务 latest 标签，未推送任何仓库：

- `order-show-ack-backend:20261012`，ID `sha256:278666805d4529317c1232e052250c08f87e4e1855f3f365d99472bd13fb8b22`。
- `order-show-ack-frontend:20261012`，ID `sha256:a4991d33d980cc82a069ef7a87509365cac6357df128ac4fda711534e71cd4ae`。

团队按部署说明重新打仓库标签后推送，或使用 `docker save -o order-show-ack-images.tar order-show-ack-backend:20261012 order-show-ack-frontend:20261012` 导出镜像。数据库和正式业务数据不在镜像内。

## 可复现的隔离验证

在新工作树根目录运行；仅限开发机。临时数据库、Redis、MinIO 使用 tmpfs，删除容器即清除测试数据。不要改成正式服务地址。

```sh
node scripts/package-dba.mjs
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml up -d
node scripts/test-ack-replicas.mjs
```

可选云端配置加载检查（用不存在的 OSS 域名，不执行对象访问）：

```sh
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml --profile cloud-check up -d cloud-check
```

检查 `http://127.0.0.1:18083/api/v1/actuator/health/readiness`。这个探测服务不作为业务副本，其 Redis 通道不同；双副本脚本开始时会先停掉它。全部验证后清理：

```sh
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml --profile cloud-check down
```

## 2026-10-12 本地密钥恢复验证

用户明确授权沿用原本地数据并重新启动后端。将原目录的 PHONE_HMAC_KEY、PHONE_ENCRYPTION_KEY 保存至当前根目录 Git 忽略的 `.env`，未记录密钥值或修改云端配置。

- 仅执行 `docker compose up -d --no-deps --no-build --force-recreate backend`；后端 readiness 返回 UP。
- 原受影响手机号的 SPECIAL 身份验证成功；登录后商品接口 HTTP 200（43 条），订单、草稿、变更申请查询和 H5 页面均 HTTP 200。仅创建验证会话，未下单或修改白名单。
- 对比操作前后容器 ID、启动时间、挂载卷：MySQL、Redis、MinIO、前端均未改变；未删除或替换数据卷。
- 本次是本地接口验证，不替代浏览器完整交互验收；真实云资源验证仍待完成。

## 必须在真实测试环境完成的项目

- PolarDB 指定版本、主写端点、TLS/证书、SQL 与锁行为验证。
- 云 Redis 认证方式、TLS、命令权限与断连重连验证。
- OSS AK/SK、地域、Bucket 私有权限、上传/读取真实文件及错误处理。
- ACK 实际 Ingress 同域路由、HTTPS、上传大小、SSE 缓冲/超时、镜像拉取和 server-side dry-run。
- 多副本 H5 并发下单/幂等、审核、抽奖全过程；手工增减副本、滚动发布、压力容量及故障恢复演练。此次双副本测试不替代完整业务压测。
- DBA 初始管理员交接、首次改密、正式数据重新导入及校验；数据库和 OSS 备份恢复。
- 构建时 npm ci 报告 30 个依赖漏洞条目（1 low、6 moderate、22 high、1 critical）。此次未升级前端依赖，需单独分析可达性和修复方案，不能把构建通过当作安全审查通过。

## 上下文同步与限制

已更新仓库 README、PROJECT、AGENTS 及部署说明；不可访问的 AI 内部记忆未声称更新。当前改动只存在 ACK 工作树，不自动合并主分支。本地与 ACK 长期并存；未来数据库、缓存、存储、任务和实时通信改动应同时验证两个环境。

Git 工作树已从工具默认的 C 盘目录移动到用户指定的平级目录，并执行 `git worktree repair`。应用的 managed-worktree 附件工具不支持手工指定的平级目录，Git 工作树登记和文件均以新路径为准。
