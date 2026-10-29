# 本地 ACK 镜像验证记录：20261029.2

日期：2026-10-29（Asia/Shanghai）。仅本地合并、构建及隔离验证；未推送 CODING、Git 或镜像，未部署云端，未替换原本地业务服务。

## 来源与范围

ACK 分支 `codex/ack-cloud-adaptation`，基线 `c034eb3`。仅合入用户指定的两个已提交改动：

| main 提交 | ACK 对应提交 | 内容 |
| --- | --- | --- |
| 74e5b8d | 3db33c2 | 白名单精确索引查询、阶梯价关联、旧数量读取复用及测试 |
| ac92fc6 | ce6fd56 | 看板、排行、战报手动刷新及回归测试 |

合并时 README 保留 ACK 历史；三个页面与旧自动刷新测试的冲突按 main 手动刷新行为解决。ACK 的 OrderService 显式事务隔离设置、RealtimeEventService、后台 AdminGateway、云配置均保留。本次额外文件修改仅为隔离验证脚本、验证默认版本及交付文档。主项目未提交的后台登录容错、容量脚本/报告、截图均未合入。

## 最终镜像

| 镜像 | 实际 image inspect ID / 索引摘要 |
| --- | --- |
| order-show-ack-backend:20261029.2 | sha256:3a348c1a2114039ef499b3ff49f17f3f2b9190745c9b1fb6fc421c2af003f07c |
| order-show-ack-frontend:20261029.2 | sha256:9304bc47d0189f3aaf105e1dffbce6c05e37fd88220243e43db001b2d261217c |

平台均 linux/amd64，运行用户分别 ordershow/node。前端重新编译，NEXT_PUBLIC_API_BASE=/api/v1；不是复用旧前端内容。双后端和前端容器的运行镜像 ID 已逐一核对，后端 readiness 200，前端页面 HTTP 200（前端镜像没有 Docker Healthcheck，不把 running 当成健康探针）。

旧版保留：后端20261029.1 ID `cf322d2d2f1ed1692cc01174b89ba1748f666b92267322b16a8752012c623f16`；前端20261029.1 ID `f184d4f618c7fe6a00671f9f7d16f4922bb28a686891ee3fbfca32f96bb96e72`。

## 构建方式

标准 Dockerfile 构建因 Docker Hub 的 Dockerfile frontend 元数据连接失败而中断。未修改网络或证书校验；采用上一轮相同的本地离线方式，临时 Dockerfile 位于 `outputs/ack-release-20261029.2/`：

- 前端对照20261029.1运行环境，package.json和package-lock.json SHA-256完全一致，再复制当前已提交源码重新生产构建。
- 后端使用本机 maven:3.9.11-eclipse-temurin-21、已有 Maven 缓存，离线执行完整默认 package/test，将新JAR放入旧ACK JRE运行环境。
- 使用 --network=none、--pull=false；标准Dockerfile和依赖版本未改。构建失败及成功日志均保留。

## 行为与数据库边界

三个统计页面在活动就绪后首次读取，之后只手动刷新；不建立统计SSE、不做15秒统计轮询或重连补拉。活动元数据检查仍保留。排行选择待应用，刷新成功才更新数据/标题/单位；战报切换展示复用数据；失败保留旧数据/成功时间；重复点击合并请求；离开/切换活动取消旧读取。

后端事件、15秒RECOVERY、共享会话及抽奖等实时功能保留。既有 `test-ack-screen-refresh.mjs` 本轮验证的是后端事件扇出与统计API，不代表新页面自动刷新。

完整当前/历史订单、审核、审计、事务和幂等保留，批次仍100，无新索引或数据库迁移，仍V039。隔离MySQL默认REPEATABLE-READ；白名单@Transactional默认隔离继承数据库，真实PolarDB默认隔离和白名单发布并发行为仍需云端核对，本轮未改变其事务规则。不能用本机结果代替云端配置验收。

## 验证结果

- 前端272项全部通过；类型检查、全量ESLint、生产构建通过；新增/调整的验证脚本另行ESLint通过。
- 后端镜像构建默认212项：167通过，45条件跳过，无失败。
- 隔离数据库18项：17通过，1项批次微基准因未启用专用开关跳过。通过项为排行10、事件领取5、白名单SQL等价1（975组身份/错误/会话对照）、商品SQL等价1（6种价格/可订/范围状态）。不把跳过的批次实验记为通过，也未修改批次大小。
- 最终镜像双副本：共享会话/CSRF、私有文件、MinIO、双执行器导入单次发布、Redis广播、重启恢复、UTC跨时区、背景及重新开放通过。
- 手动新增91项API状态断言及身份/持久化检查通过。
- 事件/统计117项API检查通过：两副本四类统计API、读取时下单、减量/撤回审批、恢复提交、历史快照、重新开放及15秒后端补偿。
- 新增 `scripts/test-ack-h5-submission.mjs --ack-smoke`：201项API状态检查通过。180项综合订单、41项特渠订单跨副本同键并发返回相同结果；不同键同版本竞争一次成功一次409；原样提交不新增版本；减量409审核拦截；旧键重放返回最初结果。当前明细分别180/41，均2个历史版本，版本明细360/82，对账一致。此脚本仅接受固定ACK smoke容器及合成夹具，需在新夹具上运行。
- test/cloud profile、带密码Redis、OSS占位配置启动并readiness 200；未访问真实OSS，不代表云资源集成通过。

### 最终镜像真实浏览器验证

使用本机18031同域代理接入隔离前端18030与后端18081，模拟Ingress路径；由实际浏览器操作，不改页面源码。三个页面首次统计各1次，静置146.015秒期间有真实合成订单提交，统计增量均0，统计SSE请求0。排行选吨数、战报选综合TOP5均未追加统计请求。

逐页点击刷新后，三类统计各累计2次（战报不同类型路径按页面合计）。页面从300元、0.3吨、1单更新为44,500元、44.5吨、3单；排行成功应用吨数口径，战报显示新增综合客户36,000元。原始计数、截图及日志在本轮输出目录。失败保留数据、取消旧读取、连续点击合并由前端自动行为测试覆盖，本轮浏览器没有逐个注入这些故障。

观察只证明请求受控和结果一致，不是容量认证。本轮未重跑旧/新版本完整高并发A/B，不使用主项目性能数值作为ACK改善幅度；多人同时首次打开或点击刷新仍会查询数据库。真实CPU、连接等待、极限吞吐和PolarDB执行计划须在目标资源下验收。

## 复验与输出

```powershell
$env:ACK_IMAGE_TAG='20261029.2'
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml up -d --no-build --wait --wait-timeout 180 mysql redis minio backend-a backend-b frontend
node scripts/test-ack-replicas.mjs
node scripts/test-manual-additions.mjs --ack-smoke
node scripts/test-ack-screen-refresh.mjs --ack-smoke
node scripts/test-ack-h5-submission.mjs --ack-smoke
```

真实数据库专项另使用一次性 `order-show-ack-h5-tests` MySQL，在专属order_show_load中恢复既有合成initial.sql；未复制业务卷。Maven启用ORDER_SHOW_LOAD、ORDER_SHOW_H5OPT_FIXTURE和ORDER_SHOW_RANKING_TEST，选择上述5个测试类。夹具、命令配置和日志留在忽略输出目录，不随生产镜像交付。

验证辅助脚本曾把不同战报路径当作单一路径计数，以及假设前端存在Docker Healthcheck；修正为按战报页面聚合及HTTP检查后通过，未修改产品代码。

## 清理、发布和回退

2026-10-29 20:58:13（北京时间）已清理ACK smoke、cloud-check和H5专属数据库的容器/网络，关闭临时代理与浏览器页。临时数据库使用tmpfs，镜像与日志保留。原业务backend/frontend/mysql/redis/minio五个容器的ID、镜像、启动时间、挂载、环境与验证前完全一致。

当前没有推送或线上部署。后续经用户授权交付时，前后端均使用本记录对应镜像，测试验收后以同一摘要发布；重新加载已打开的浏览器页面，旧页面内存中的自动轮询不会仅因后端升级而停止。滚动更新期间短暂存在旧前端行为，不能提前宣称统计压力已降低。

本轮无结构变更，回退应用不需覆盖数据库。隔离环境回退可设置 `ACK_IMAGE_TAG=20261029.1` 重建两副本和前端；云端由运维恢复上一套已验收的镜像摘要并核对健康、订单/历史统计及抽奖。前端回退会恢复自动刷新及其查询负载。

真实ACK、PolarDB、Redis TLS、OSS和Ingress SSE尚待部署环境验证；连接预算保持每副本10，计入滚动更新额外副本。不要将本轮合成库、密钥或本地参数复制到云端。
