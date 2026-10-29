# 本地 ACK 镜像验证记录：20261029.1

日期：2026-10-29（Asia/Shanghai）。本地构建与隔离验证完成，未推送 CODING、未推送 Git、未部署云端。

## 分支与范围

工作目录为 E:\fengyi\order_show-ack，分支为 codex/ack-cloud-adaptation；从 ACK ad0e584 合入 main dc4b76c，并补齐 ACK 的周期刷新协调与多副本事件领取优化。本记录所在合并提交包含最终源码、验证脚本和部署说明。

- 统计按当前活动、有效订单及筛选范围汇总，复用订单吨数和项目组小计；业务口径、排名资格与顺序、排行上限及历史快照规则保持原样。
- 活动信息就绪后发起统计，取消失效页面或筛选的读取。
- 前端轮询与 ACK 后端每 15 秒的补偿通知共享页面读取间隔。补偿通知新增 reason=RECOVERY；普通变更、未知通知、重连及手动刷新仍立即读取，正在读取时收到真实变更保留后续读取。提前到达的重复周期触发会预约准确到期的补拉，不等待下一轮轮询；慢请求超过 15 秒仍保留补偿检查，不用 TTL 缓存或事件最大 ID 跳过真实变更。
- 发布器在 READ COMMITTED 事务中用 FOR UPDATE SKIP LOCKED 领取已提交事件，按活动发送 Redis 通知后精确确认所选 ID。每轮仍最多 8 批、每批 1,000 条；失败回滚后重试。正常并发不重复领取同一行；发送后提交失败仍允许重发，不承诺恰好一次。
- 保留 ACK 的共享会话、Redis 广播、OSS/MinIO 配置选择、云端关闭初始化与迁移等适配。没有新增数据库结构、索引或迁移，仍为 V039。

## 最终镜像

| 本地镜像 | 实际镜像 ID / 索引摘要 |
| --- | --- |
| order-show-ack-frontend:20261029.1 | sha256:f184d4f618c7fe6a00671f9f7d16f4922bb28a686891ee3fbfca32f96bb96e72 |
| order-show-ack-backend:20261029.1 | sha256:cf322d2d2f1ed1692cc01174b89ba1748f666b92267322b16a8752012c623f16 |

平台均为 linux/amd64；前端非 root 用户 node，后端非 root 用户 ordershow。前端编译使用 NEXT_PUBLIC_API_BASE=/api/v1，最终产物已核对同域 API 路径。后端最终构建执行了全部默认测试，没有跳过构建测试。

两个最终镜像均在隔离环境启动并核对运行镜像 ID。版本仅存在本机，未上传仓库；此前已交付的 20261027.1 保留不变。

## 构建方式与已记录的问题

标准构建遇到 Docker Hub 的 EOF 和证书域名不匹配，未关闭证书检查或修改系统网络。采用现有本地基础环境离线构建：

- 前端先核对 20261027.1 镜像和源码的 package.json、package-lock.json SHA-256 完全一致，再使用原 Node 与依赖重新编译。新镜像内替换 dist/public，保留原运行用户和启动方式。
- 后端使用本地 maven:3.9.11-eclipse-temurin-21 和 BuildKit Maven 缓存，以离线模式执行完整 package/test；将新应用包放入原 ACK JRE 运行环境。
- 最终前后端构建均使用 --network=none、--pull=false，未修改标准 Dockerfile、依赖版本或业务配置。备用构建文件、哈希和日志保留在 outputs/ack-screen-20261029.1/。

最终复核增加了真实变更发生在轮询中间的到期补拉测试，避免周期去重将兜底推迟到下一轮。完整前端 266 项再次通过，前端镜像重新构建并单独启动核对四个页面和编译产物；后端镜像与已经通过双副本业务验证的版本相同。

首轮真实排行测试暴露历史快照 generatedAt 的数字纳秒精度差异。保留 ACK 的 Jackson builder，并在测试中显式关闭 WRITE_DATES_AS_TIMESTAMPS，与实际业务 ISO 时间格式一致；随后 10 项真实排行测试全部通过。业务日期处理未改。首轮失败日志与后续通过日志均保留。

## 验证结果

- 前端完整 266 项测试全部通过，类型检查、ESLint 和生产构建通过；新增脚本单独规范检查通过。
- 后端最终构建 204 项：162 通过、42 按环境条件跳过，0 失败。没有把跳过项计为通过。
- 在固定 ACK 隔离 MySQL 中另行运行 10 项排行测试及 5 项事件领取测试，15 项全部通过、无跳过。覆盖并发领取互斥、Redis 失败、无订阅者、确认失败回滚和低 ID 迟提交。
- 新旧统计实现大数据逐字段对照通过：两种排行、客户类型/大区筛选、10 类看板/战报、即时变更、截止/结束/归档、重新开放及空有效订单。只排除自然变化的 generatedAt。
- 最终镜像双副本验证通过：共享登录/CSRF、私有文件、MinIO 上传下载、双执行器导入单次发布、Redis SSE 广播、重启后会话恢复、背景上传重置、重新开放和过期版本拒绝；MySQL +08:00 与副本 B Asia/Shanghai 下 UTC 往返通过。
- 手动新增回归 95 项 API 状态断言及身份、持久化、拒绝检查通过。
- 新增 scripts/test-ack-screen-refresh.mjs 完成 117 项 API 状态检查：两副本上的看板、金额排行、吨数排行和总战报，读取期间提交/减量审批/撤回审批/恢复下单，收到真实通知后读取最新统计，15 秒补偿通知、历史查看、重新开放及增量下单均通过。正常测试期间未观察到同一版本的重复广播。
- 小型 API 夹具的 5 次写入、收到双副本通知并完成统计核对合计约 277–505 ms；该结果不是大数据或高并发时延承诺。
- 每个测试副本按 ACK 模板配置 DB_POOL_SIZE=10；两个副本均已核对，测试后观察到 20 个业务账号连接。没有调大云端连接池，真实连接余量及滚动发布额外副本仍需部署时核对。
- 管理页、看板、排行、战报均 HTTP 200；两个后端健康正常，测试日志无 ERROR、死锁或 SQL 语法错误。
- test/cloud profile、带密码 Redis、非生产 OSS 占位配置启动成功，readiness 为 UP；没有访问真实 OSS，该项仅证明配置启动。
- DBA 空库包在隔离数据库中使用至 V039，未创建 Flyway 历史表；没有新增数据库迁移或修改生成的 DBA SQL。

## 同规模 SQL 性能对照

基线为 ACK ad0e584 的原统计代码。合成夹具共 4 个活动、6,480 张订单和 861,532 条明细；目标活动初始 1,620 单。每场景预热后交替执行 10 对读取，沿用测试的上中位数口径（10 个值排序后第 6 个），P95 为 nearest-rank，在本样本中为最大值。

| 场景 | 原版中位 ms | 优化后中位 ms | 原版 P95 ms | 优化后 P95 ms | 统计 SQL 数 |
| --- | ---: | ---: | ---: | ---: | --- |
| 金额排行 | 2192.55 | 677.27 | 2431.54 | 693.64 | 8 → 6 |
| 吨数排行 | 2231.13 | 654.36 | 2377.61 | 707.02 | 8 → 6 |
| 看板/战报 | 2928.25 | 934.72 | 3182.53 | 1029.60 | 18 → 13 |

这些是统计服务/JDBC 耗时，含测试连接开销，不含完整 HTTP、Ingress、活动信息组装或浏览器渲染。看板/战报 P95 约 1.03 秒，尚未达到暂定 1 秒目标；未据此宣称完成千人持续压测或真实 ACK 容量验收。

## 复跑方式

在 ACK 目录使用固定隔离栈（配置默认版本 20261029.1）：

~~~powershell
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml up -d --wait mysql redis minio
docker build --platform linux/amd64 -f deploy/verify/Dockerfile.ranking .
docker compose -p order-show-ack-smoke -f deploy/verify/compose.yaml --profile cloud-check up -d --wait backend-a backend-b frontend cloud-check
node scripts/test-ack-replicas.mjs
node scripts/test-manual-additions.mjs --ack-smoke
node scripts/test-ack-screen-refresh.mjs --ack-smoke
~~~

大数据对照需要先从 ad0e584 提取 DashboardService.java，将类名与构造函数改为 DashboardBaselineReference，临时放入同包测试目录（已有文件时不得覆盖），再运行 deploy/verify/Dockerfile.screen-compare；固定端口 18306，专用 order_show_dashboard_compare 库，只接受显式 ACK smoke 开关。完成后移除自己生成的参考文件。参考源码与本次完整日志已归档到输出目录，未进入 Git 或生产应用。

## 清理与回退

本次验证完成于 2026/10/29 15:33:20（北京时间）。ACK smoke 容器与网络已清理，镜像与日志保留。原有 5 个业务容器的 ID、镜像、启动时间和挂载与验证前完全相同，没有向原业务数据库写入测试数据。

若需在隔离环境回退，使用 ACK_IMAGE_TAG=20261027.1 重新启动专用 smoke 栈。旧前端摘要 137c6d07cfdde4236a2d5821fcfa1f705c8a9d3b578d67e7febfeba5c556ea02、旧后端摘要 d4ae85c6577506fd3efd8161ccee6fcca544646ae1b84155f0419c7982216001 已核对保留。

本次无数据库迁移，应用回退不需要覆盖数据库。云端尚未升级；后续交付时应同时更新前后端，旧前端/后端混用期间仍能刷新，但周期去重需新前后端配合；新旧后端并存时，旧发布器仍可能重复广播，事件领取优化在后端副本全部更新后完整生效。

## 后续待完成

按本次要求未推送 CODING、未推送 Git、未部署云端。真实 ACK、PolarDB、托管 Redis TLS、OSS、Ingress SSE、连接预算与高峰负载验收仍待部署环境验证。已有活动排行配置及历史快照的 DBA 处理继续参照 20261027.1 记录，不能套用本地测试数据。

相关记录：[主项目优化测试](../docs/testing/screen-performance-2026-10-29.md)、[ACK 部署说明](README.md)、[验证索引](verification.md)。
