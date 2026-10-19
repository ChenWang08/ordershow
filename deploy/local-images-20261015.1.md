# 本地 ACK 镜像验证记录：20261015.1

日期：2026-10-15（Asia/Shanghai）。状态：已构建、完成本地隔离验证，并已推送 CODING；远端摘要及 linux/amd64 平台已核验。本次新版本尚未由本聊天部署到 ACK，测试环境升级结果待部署团队反馈。

## 代码与合并

- 合并前 ACK：`5dce7b8`；合入 main：`65eacb7`，共 5 个新提交。
- 保留 MinIO/OSS 配置选择、云端禁止自动迁移、Redis 跨副本广播和导入任务数据库领取机制。
- ActivityService 冲突使用 main 的独立 ActivityLifecycleScheduler，通过事务代理调用；保留 ACK 的条件更新，只有更新成功的副本写入事件。
- 活动背景通过共享对象存储及数据库引用保存；重新开放订货使用部门/活动数据库锁、版本检查、事务内事件与审计，不依赖进程本地状态。
- 未增加连接池或线程预算。扩容仍按副本数 × DB_POOL_SIZE，并计入滚动更新额外副本核算。

## 本地镜像

| 镜像 | 本地索引摘要 |
| --- | --- |
| `order-show-ack-frontend:20261015.1` | `sha256:a218e1f52b465845e64fcb960e965937be0e44074736a326a080645ed97813bf` |
| `order-show-ack-backend:20261015.1` | `sha256:e621072bc1dc41f9d7019bec25f42537695480f037f99c987013f63ab7174ffd` |

两者均为 linux/amd64；前端 NEXT_PUBLIC_API_BASE=/api/v1，后端 SKIP_TESTS=false。旧 20261012 标签保留不变。构建上下文为本次合并后的工作树，后续新增内容仅为验证脚本和文档，不改变镜像业务代码。

## 验证结果

- 前端构建、203 项测试（全部通过）、类型检查及全项目 ESLint 通过。
- 后端构建和测试通过：190 项，160 通过、30 按环境条件跳过，0 失败。未把条件跳过项计作通过。
- 隔离 MySQL 8.4 执行全新 DBA SQL 至 V039；没有 Flyway 历史表。
- 双后端跨副本会话/CSRF、MinIO 文件上传下载与私有文件保护、两执行器单次发布导入、Redis SSE 广播、重启副本后会话保留通过。
- 新增跨副本背景上传/匿名读取/重置、重新开放订货、过期请求拒绝及单个重新开放事件验证通过。
- 前端 /admin、/h5、/screen/SMOKE/report 均 HTTP 200；这是页面响应检查，不替代完整浏览器交互验收。
- test/cloud profile + 带密码的隔离 Redis 启动成功，readiness HTTP 200 / UP。OSS 使用 oss.invalid 占位端点，仅验证云配置启动，不声称真实 OSS 读写通过。
- 首次后端构建因冲突编辑未成功而失败，修正后编译通过；下一次因 Maven TLS 下载中断失败，标准重试后成功。
- npm 在容器安装时报告依赖审计告警（30 项）；本次未变更依赖版本或执行自动修复，发布前另行评估依赖风险。

## 数据库与待验证项

- 新空库执行重新生成的 deploy/dba/generated/fresh-install.sql（包含 V039）。
- 已有 V038 云库必须由 DBA 先执行 db/migrations/V039__activity_backgrounds.sql，并记录版本；不可重跑空库包。
- 无新增 Java 迁移；V037 对全新空库不适用的处理不变。
- 真实 ACK Ingress/HTTPS、PolarDB、托管 Redis TLS、OSS 权限和读写、多副本容量，以及完整浏览器交互仍待验证。
- 本次没有操作原业务容器；前后核对 ID 均一致：frontend 47f5e60a32f8、backend 125d37b8f539、redis 3119aace5127、mysql 3215f4c64d8e、minio a0a861a15813。
- 验证完成后已清理本次全部 order-show-ack-smoke 容器和网络，保留本地新旧 ACK 镜像。

## CODING 交付结果

用户在本地终端完成前后端推送后，2026-10-15 再次通过 docker buildx imagetools inspect 查询两个远端标签，均成功；索引摘要与上表本地已验证镜像一致，业务平台均为 linux/amd64。

前端：
`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-frontend:20261015.1`

后端：
`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-backend:20261015.1`

此前多次上传曾出现超时、broken pipe、连接关闭或 Docker 引擎不可用，部分层已上传。上述失败均为历史状态；最终两个标签已经存在并核验成功。新旧本地运行层对比：前端 9 层中 8 层不同，后端 9 层中 3 层不同。用户最后一次推送复用了此前成功上传的层。不能据此单独确定最初网络故障原因。

## 测试环境增量升级与回退

用户确认旧 20261012.1 已部署测试环境。本次由部署团队将两个应用更新为上述新地址，保留原数据库、Redis、OSS、业务密钥和其他环境配置；镜像上传本身不修改云端数据。

DBA 改表前备份并确认当前结构版本：已有 V038 只执行 db/migrations/V039__activity_backgrounds.sql 并记录 V039，已执行则不重复执行。严禁对已有业务库执行 fresh-install.sql、重建业务库或覆盖导入数据。V039 增加背景引用字段和外键、扩展文件用途约束，不包含删除业务数据操作。

数据库准备完成后更新后端和前端，检查健康状态、已有活动及订单数据、登录、H5 入口、活动背景、重新开放订货和展示页面。真实云资源与浏览器验收仍由部署团队完成并反馈。

旧 20261012.1 仓库版本保留用于应用回退；数据库回退由 DBA 评估，切换镜像不会撤销 V039。本地隔离验证配置默认 ACK_IMAGE_TAG=20261015.1；仅对 order-show-ack-smoke 做隔离测试生命周期操作。
