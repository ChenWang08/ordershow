# 活动资料普通 HTTP：实现与验证（2026-11-01）

## 范围

以 main `e3cacc3` 为基线修改本地工作区。H5、看板、排行、战报及抽奖共用资料改为普通 HTTP JSON，页面不再建立活动 SSE。后端旧 `/events` 暂保留旧客户端兼容，不作为新前端失败回退；其他事件与业务通道不在此次删除范围。无新增 Flyway 迁移，继续使用 V049。

最多约 1000 人在线指约 1000 个 H5 订货页，不按每人同时打开全部大屏计算。看板/战报打开后首次查询、排行打开先读选项且确认后统计，之后手动刷新；抽奖仅在页面打开且活动资料就绪后读取。H5 初始化不预加载这些页面数据。

## 实现

- `GET /api/v1/public/activities/{activityCode}` 返回原 JSON 包装 `data`/`traceId`。弱 ETag 由活动 ID、共享数据库的公开资料版本和时间派生状态组成；If-None-Match 未变化返回空正文 304。
- 版本读取按活动编号索引只读取活动一行，不加入部门、白名单、地区或订单查询。默认短缓存 2000ms，同活动读取串行合并；完整资料按版本和状态缓存，使用原只读 REPEATABLE_READ 快照服务，响应标签取实际快照版本，避免查询期间写入导致标签与正文错配。
- 每副本最多缓存 64 个活动；最多 2 个数据库加载、128 个读取者，同活动等待上限 3000ms；等待位于数据库事务外。容量满时淘汰无读取者的旧活动，全部忙或等待超时返回 503 `ACTIVITY_INFO_BUSY`。不扩大数据库连接池。
- 多副本从同一主写数据库读取版本，2 秒短缓存到期后感知提交，不以 Redis Pub/Sub 为一致性必要条件。时间派生状态在每次检查时计算，不能仅因版本未变而错过开始/截止/整场结束。
- 浏览器首次立即请求；成功后间隔 27～33 秒随机错开。隐藏、离开和 bfcache 暂停并取消请求，恢复立即检查。仅一个请求在途，活动切换/卸载后的旧响应不能更新新页面。
- 每次请求及完整 JSON 读取共用 10 秒超时。失败显示重试入口，按约 2/4/8/16/30 秒退避并错开，保留上次资料和购物车。不存在活动显示提示，可手动重试；恢复可见也重新检查。
- 资料更新不触发商品、订单或统计查询；下单、开奖仍由服务器按最新权限、版本、时间和状态校验。HTTP 成功不代表订单提交成功。
- 本地跨端口 CORS 已允许 If-None-Match，并沿用 ETag 暴露；ACK 仍应构建同域 `/api/v1` 前端。

## 已执行验证

| 项目 | 结果 |
| --- | --- |
| 前端完整回归 | 379 通过，0 失败/跳过 |
| 类型检查、修改文件 ESLint | 通过 |
| 后端完整回归，显式启用活动资料数据库专项 | 375 项：264 通过、111 按专项环境条件跳过，0 失败/错误 |
| 真实浏览器，合成 HTTP，390px/1440px | 通过：StrictMode 单次首读、条件检查、无活动 SSE、购物车保留、排行不自动重查、失败重试、隐藏/恢复 |
| 截图检查 | 390px 重试按钮在手机容器内可见；数量 7、金额 70 元保持 |
| 300 单/分钟负载 | 约 180 秒、900 常规新单加 20 单集中提交，全部成功；常规提交 P95 63ms、最慢 1317ms，集中提交 P95 269ms；920 单/165600 明细/920 历史版本及汇总对账一致 |
| 本地镜像及部署验收 | 标准 Dockerfile 构建成功并部署 `local-http-20261101.1`；12 个活动普通 GET 200/条件 GET 304、五类页面通过真实浏览器检查 |

## 本轮负载和本地部署

`ActivityInfoHttpLoadTest` 在专属临时 MySQL/Redis 环境执行，负载调度窗口 179.824 秒：每秒 5 个已验证合成客户，共 900 个常规首次提交，另在中点加入 20 个客户集中提交。每单 180 种商品，首次活动 JSON → 商品目录 → 正式提交 → 确认读取均走真实 HTTP；不包含真实手机号验证、图片下载或浏览器绘制，也不执行千人持续资料检查压测。失败数 0，订单/明细/版本数量及金额和产品线汇总校验全部通过；常规和集中提交 P95 均低于 1000ms 门槛，常规最慢请求仍为 1316.583ms。

后端及测试客户端在同一 Maven 容器，限制 2 CPU / 1280MiB，JVM `-Xmx384m`，数据库池 10、写入并发 6、H5 会话缓存关闭、汇总开启；测试 MySQL/Redis 未单独设 CPU/内存上限，MySQL 使用 tmpfs。不能将此配置描述为与 ACK 资源等价或作为云端性能保证。该轮只新增并提交订单，未混合后台调价、开奖或多人统计刷新。测试临时容器及网络已移除，未连接日常业务库。

本地先更新后端并逐个核验 12 个未归档活动，再更新前端。真实浏览器使用活动 `HD20261101013`：H5 不请求统计/抽奖；看板/战报各首次读取一次统计；排行确认前无统计、确认后一次；抽奖仅自身页面读取一次。五页均初读 200，浏览器时钟推进 35 秒后返回 304，统计请求数不增加、活动 SSE 请求数 0。截图已检查，并等待统计完成后取证；不是持续 35 秒实际网络压测。已有 462 笔订单、2745 条当前明细及 510 条历史版本和关键表校验值与部署前一致；源码清单的 338 个文件、实际配置和数据服务身份均核对一致。完整镜像、备份和恢复说明见[部署记录](../deployment/2026-11-01-activity-http-local.md)。

后端 8 项缓存/并发测试覆盖同活动 50 个等待请求合并加载、100 次未变化条件检查跳过完整读取、版本变化、时间边界、版本查询与完整快照之间的竞争、资源上限及两个独立缓存读取共享版本。真实 HTTP 集成覆盖 200/304/404、提交后更新、独立读取者缓存；旧 SSE 的真实 HTTP/Redis 恢复与事务回滚验证继续保留。两个独立读取服务不是双节点 ACK 容量验收。

初次后端运行发现 Mockito 在重新设置抛错桩时执行旧桩，以及旧 SSE 测试统计全库事件被新增 HTTP 夹具影响；均已修正测试隔离后完整重跑通过。前端 HTTP 服务测试与浏览器最初受本机受限执行环境影响，使用允许本机测试端口的运行方式及已有浏览器后通过，不安装依赖到业务环境。

## 复现

```powershell
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
docker compose -f tests/activity-info.compose.yml up -d --wait --pull never
docker run --rm --network order-show-activity-info-test `
  -e ORDER_SHOW_ACTIVITY_INFO_TEST=order-show-activity-info-test `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml test
# 负载须与镜像构建错开；固定临时库需没有 HTTP-ORDER-LOAD 夹具。
docker run --rm --cpus 2 --memory 1280m --network order-show-activity-info-test `
  -e ORDER_SHOW_ACTIVITY_HTTP_LOAD=order-show-activity-info-test `
  -e JAVA_TOOL_OPTIONS=-Xmx384m `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml '-Dtest=ActivityInfoHttpLoadTest' test
node scripts/test-activity-info-browser.mjs
docker compose -f tests/activity-info.compose.yml down
```

浏览器通过 `ORDER_SHOW_PLAYWRIGHT_MODULE` / `ORDER_SHOW_BROWSER_PATH` 选择已安装工具，不新增业务依赖。证据在忽略目录 `outputs/activity-http/`，合成浏览器截图在 `outputs/activity-info/`。备份、私有配置及会话不能上传。

## 尚待真实环境验收

本轮不向公网提交测试订单，不操作 ACK，不推送 CODING。真实 WAF 的 JSON/304 转发、HTTPS、PolarDB/Redis/OSS、多副本滚动恢复和目标配置容量均待部署后验收。单次本机测试通过不能承诺 1000 个真实浏览器或长期云端容量。

普通 HTTP 用于适应当前公网链路不能稳定传递活动 SSE 的情况。2 秒缓存与并发合并只减少数据库工作量，浏览器请求仍经过 WAF；这不是 WAF 配置修复，实际公网是否正常仍须部署后验证。

后续 ACK 使用同一业务改动并保留云适配；配置仍遵守每副本 10 个数据库连接及滚动额外副本预算，不照搬本地 60 连接。部署时先更新全部后端并确认普通 GET 可用，再更新前端；已打开的旧页面须重新打开。旧 SSE 镜像不能被视为已解决公网故障的回退版本。
