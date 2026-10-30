# Handoff：H5 下单 30 并发 < 1000ms

> 环境/时点说明（2026-10-30 更新）：本文保留另一台电脑与 `home_server` 当时的交接记录，以下“未提交”“不要打开汇总”等要求仅描述该轮环境和方案，不代表当前 `E:\fengyi\order_show` 本机状态。本机 `main/d36cbca` 已完成独立功能与 10 写＋5 读混合验证，并在备份、升级、回填对账后开启汇总；见[最新本地部署记录](../deployment/2026-10-30-summary-local.md)和[测试报告](../testing/local-summary-validation-2026-10-30.md)。本次未访问或更新远程环境，不据此声称远程 30 并发门槛通过。

日期：2026-10-30（压测时刻约 02:36–02:45 CST，库内时间约 2026-10-29 18:36–18:45 UTC）。
代码仓库：`/Users/didi/workspace/order_show`。不要在 `/Users/didi/workspace/ra_tools` 里改订货会代码。
本文件未提交。同目录的 `h5-concurrency-architecture-plan.md` 是更宽的路线图，其中 `innodb_flush_log_at_trx_commit=2`、400–600ms 预期、内存定价引擎都没有被本轮批准。以本 handoff 和当时批准的计划为准。

## 结论

门没有过。门只看下单 PUT：暖机后的并发 30，综合客户、约 170 行，P50 和 P95 都要 < 1000ms，err=0。

已上线的代码（不写版本明细、去掉行触发器、幂等不再存整单 JSON、loadProducts 一次取图）加上 MySQL 缓冲池 512MB 之后：

| 并发 | 仅代码、缓冲池 128MB，下单 P50/P95 | 缓冲池 512MB，下单 P50/P95 |
|---|---|---|
| 1 | 87.8 / 87.8 | 76.6 / 76.6 |
| 10 | 504.5 / 555.2 | 468.8 / 509.4 |
| 30 | 1131.0 / 1540.8 | 977.0 / 1202.7 |

三档 err=0，链路 100% 成功。512MB 那次 P50 已低于 1000ms，P95 仍是 1203ms。按原计划，缓冲池只允许再测一次，这一次已经用掉。列收窄留在本轮之外，没有做。不要把 `flush_log_at_trx_commit` 改成 2。不要再调连接池、准入或线程。

改代码之前、池子已经调过的基线（镜像 `9acb385`，综合单约 174 行）：并发 1 下单 P95 104ms，并发 30 下单 P50 1188.3 / P95 1353.0，err=0。日志 `D:\Coding\h5-mix-full-29014.log`。当时整链六步 P50 相加约 2387ms。吞吐大约并发 30 为 22 单/秒。并发 30 要稳进 1 秒，需要大约 30 单/秒。

同一夜还有一档不能当门：`h5_stress_s3_20261030_0237`，并发 30 下单 P50 553 / P95 699。那一档吃到的是剩余特渠号，每单 41 行。写号池里综合号已经用完，`take()` 从文件头往后拿，综合在前、特渠在后。

## 现在线上是什么

home_server，SSH 别名 `home_server`，Tailscale `100.66.1.66:11022`，用户 `cjh`，远程 shell 是 PowerShell。代码在 `D:\Coding\order-show`，分支 `perf/h5-verify-latency`，HEAD `9acb385211a50320343df640335f8d5f430785eb`。Mac 与服务器都是这个 HEAD，加上未提交改动。`main` / `origin/main` 是 `079281b`。不要改 GitHub 历史，不要改 baby 的提交。没有提交，没有推送。

Compose 项目名 `order-show`。端口：前端 13000，后端 18080，MySQL 13306，Redis 16379，MinIO 19000/19001。上下文路径 `/api/v1`。就绪检查是 `http://127.0.0.1:18080/api/v1/actuator/health/readiness`。裸 `/health` 和 `/actuator/health` 返回 404。

本轮结束时：

- 后端镜像已重建并健康。构建日志里的 manifest list 是 `sha256:4994ea3f740dd4ae85a76b3e4a3609f3dade435e01a4b5b59b6c5a5945b10d7a`。Dockerfile 的 `SKIP_TESTS=true` 仍会编译测试，不会跑测试。
- Flyway 成功到 V041。`information_schema` 里 `order_item` 触发器数量是 0。
- `DASHBOARD_SUMMARY_ENABLED=false`。不要打开汇总读路径。
- `innodb_buffer_pool_size=536870912`（512MB），`innodb_flush_log_at_trx_commit=1`。只重建过 `order-show-mysql`。
- 缓冲池写在 Mac 和服务器的 `docker-compose.yml` 的 mysql `command` 里，跟 charset 参数放在一起。未提交。
- 环境仍是：`H5_WRITE_CONCURRENCY=36`，`DB_POOL_SIZE=60`（Hikari 最小 30），`HTTP_MAX_THREADS=60`，JDBC `cachePrepStmts`、`prepStmtCacheSize=250`、`prepStmtCacheSqlLimit=2048`。
- 活动 HD20261029013（id 13）仍是 ACTIVE、1500 笔 SUBMITTED。必须保持。
- 活动 HD20261029014（id 14，名 “1029 Load”）ACTIVE，1157 笔 SUBMITTED。下单窗口结束 2026-10-31 15:48:52 UTC。接手时先核对 `ends_at` 和订单数，时间过了就不能再写。
- 新的综合单已核对：169–170 行，每单 1 条 `order_version`、0 条 `order_version_item`。幂等 `response_json` 平均和最大都是 74 字节，`format=2`，没有 `resultJson`。这些新单没有 `order_dashboard_stat` 行。
- homelab-nginx-compose、homelab-authelia、my_redis、my_postgres 全程没重建。当时宿主机空闲内存约 13.8GB，后端约 709MB，MySQL 约 1.3GB。Docker Desktop 虚拟机大约 15.5GB，不要加大，也不要重启 Docker Desktop。
- 停机线：宿主机空闲内存 < 4GB、后端容器 > 4GB、就绪检查失败，或 homelab 容器被换掉。

## 代码改了什么

四项都在 Mac 工作区，也已经打进 home_server 的后端镜像。

1. 首次下单只写 `order_version` 头，不写 `order_version_item`。当前版本的历史从 `order_item` 投影。任何替换或改价当前行的路径，必须在改行之前、并且在 `current_version_no` 加一之前，把 `order_item` 快照进该版本的 `order_version_item`。快照 SQL 用 `v.version_no = o.current_version_no`。`customer_type` 来自 `customer_order`，`order_item` 没有这一列。`NOT EXISTS` 表示已有快照不补洞。`saveRepriced`、非首次 H5、管理员批准修改、管理员调整，都是先快照再改。`PriceSyncService` 和 `TonnageSyncService` 只在行真的变化时、`updateItem` 之前快照。管理员新建不快照、不写版本明细。`insertVersionItems` 方法留着，测试还在调用，不要删。
2. Flyway `db/migrations/V041__drop_order_item_dashboard_triggers.sql` 删除 `dashboard_item_insert` / `dashboard_item_delete` / `dashboard_item_update`。不要改 V040。`db/schema.sql` 里触发器换成注释。汇总关闭时 `DashboardSummaryStore.refresh` 直接返回。打开时用 `INSERT ... ON DUPLICATE KEY UPDATE dirty=TRUE`，不要用 `INSERT IGNORE`（干净行会一直干净，重建被跳过）。裸 SQL 改明细不会自动标脏，维护走 `DashboardSummaryCommand`。不要给 SUPER，不要改 `log_bin_trust_function_creators`。
3. `completeH5Submission` 现在是 5 个参数，最后一个是 `includeHistory`。成功记录只存 `format`、`orderId`、`orderVersion`、`includeHistory`。用 `Map.of`，不能有 null。回放优先用旧的 `resultJson`；没有则 `order(orderId, includeHistory)`，默认 false。没有 format 2 的 `{"orderId":11}` 仍抛 `IDEMPOTENCY_RESULT_UNAVAILABLE`。回放可能看到后来的管理员修改，这是接受的。控制器的 `includeHistory` 默认 true 不要改。生产 H5 `app/services/api/h5-orders.ts` 和压测脚本已经传 false。
4. 只有 `loadProducts`：主图改成 `ROW_NUMBER()` 派生表 LEFT JOIN。经销商范围子查询只在该活动真有 `activity_product_dealer_scope` 行时拼上。没有这些行时，客户类型、可见、可订、分公司范围、客户/白名单绑定（`current_version_id`）仍然要查。不要改 `ProductDealerScopeService.ALLOWED_SQL`、商品列表接口、草稿接口。价格档 LEFT JOIN 留下。`uk_product_price_tier(activity_product_id)` 保证一行，不存在 “行膨胀导致 PRODUCT_NOT_ORDERABLE” 这个问题，不要去修。

投影规则：`withCurrentVersionItems` 只给 `version_no = current_version_no` 且版本明细为空的那一版补 `order_item`。更老的空版本保持空。`includeHistory=false` 不读版本表。

## Mac 上未提交的文件

分支 `perf/h5-verify-latency` @ `9acb385`。

已修改：

- `backend/src/main/java/com/fengyi/ordershow/dashboard/DashboardSummaryStore.java`
- `backend/src/main/java/com/fengyi/ordershow/order/OrderRepository.java`
- `backend/src/main/java/com/fengyi/ordershow/order/OrderService.java`
- `backend/src/main/java/com/fengyi/ordershow/order/PriceSyncService.java`
- `backend/src/main/java/com/fengyi/ordershow/order/TonnageSyncService.java`
- `backend/src/test/java/com/fengyi/ordershow/dashboard/DashboardSummaryIntegrationTest.java`
- `backend/src/test/java/com/fengyi/ordershow/order/H5IdempotencyPersistenceTest.java`
- `backend/src/test/java/com/fengyi/ordershow/order/OrderSubmissionReadReuseTest.java`
- `backend/src/test/java/com/fengyi/ordershow/order/PriceSyncServiceTest.java`
- `backend/src/test/java/com/fengyi/ordershow/order/TonnageSyncServiceTest.java`
- `db/schema.sql`
- `docker-compose.yml`（只多了缓冲池参数）

未跟踪：

- `db/migrations/V041__drop_order_item_dashboard_triggers.sql`
- `backend/src/test/java/com/fengyi/ordershow/dashboard/DashboardSummaryRefreshTest.java`
- `backend/src/test/java/com/fengyi/ordershow/order/OrderSubmitWritePathTest.java`
- `docs/design/h5-concurrency-architecture-plan.md`
- 本文件

服务器上生产源文件、`schema.sql`、V041、两份因签名编译失败而补传的测试（`H5IdempotencyPersistenceTest`、`OrderSubmissionReadReuseTest`）以及 `docker-compose.yml` 的缓冲池行已经就位。`PriceSync` / `Tonnage` 的测试更新和两份新测试没有全部拷到服务器。镜像不跑测试，所以当时能编过。下次从 Mac 再构建前，把测试一起同步，否则 `-DskipTests=true` 仍会在 testCompile 失败。

服务器上还有与本轮无关、不能覆盖的本地改动：`Dockerfile.frontend`、`app/services/api/client.ts`、`docker-compose.override.yml`、`compose-up.exit`。不要 `git checkout`、不要 `git reset`、不要整目录覆盖。

## 测试

Mac 没有系统 Java。单测用：

```bash
docker run --rm -v /Users/didi/workspace/order_show:/src -v order-show-m2:/root/.m2 -w /src/backend \
  maven:3.9.11-eclipse-temurin-21 \
  mvn -o -Dtest=OrderSubmitWritePathTest,OrderSubmissionReadReuseTest,DashboardSummaryRefreshTest,TonnageSyncServiceTest,PriceSyncServiceTest,OrderAfterSubmissionTest,OrderItemBatchTest test
```

镜像 `maven:3.9.11-eclipse-temurin-21`，sha256 `6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237`。上述类在 2026-10-29 18:19–18:22Z 是绿的。`OrderSubmitWritePathTest` 8 个，`DashboardSummaryRefreshTest` 3 个。JdbcTemplate 变参要用 `any(Object[].class)`，否则 Mockito 匹配不到，`completeH5Submission` 会因 update 返回 0 抛 “Submission result was not saved”。

`H5IdempotencyPersistenceTest` 和 `DashboardSummaryIntegrationTest` 有环境开关，没对真实 MySQL 跑。快照 SQL、历史投影、`loadProducts` 文本、紧凑回放都只在 Mockito 或字符串断言里验证过。线上那 41 笔综合单补上了 “0 条版本明细、幂等 74 字节” 的证据。`loadProducts` 没有单独对 MySQL 执行过。

## 部署时踩过的坑

- 第一次 `docker compose ... up -d --no-deps --build backend` 失败：testCompile 报 `completeH5Submission` 少一个 boolean。补上两份测试后，同命令成功。必须带 `--no-deps`，否则会牵动 mysql、redis、前端。
- 多文件 `scp` 到 `db/migrations/` 会把 Java 和 `schema.sql` 也丢进迁移目录。要用 `Move-Item -Force` 放回原路径。不要在 `db/migrations` 里留 `.java` 或 `schema.sql`。PowerShell 远程命令不要用 bash 风格的 `@'...'@` here-string，解析会失败。
- 远程控制台是 GBK。Python 打印前用 ascii `backslashreplace`，或设 `PYTHONIOENCODING=utf-8`。
- `ssh home_server "py -3 -u -" << 'PY'` 可用。命令行里不要让异常把 `MYSQL_PWD` 打出来：`CalledProcessError` 的 args 里有密码。密码从容器环境读，用 `docker exec -e MYSQL_PWD`。
- Tailscale 曾要重新登录。Mac 上没有可用的 `tailscale` CLI。SOCKS 是 OrbStack 的 `ts-proxy`，`127.0.0.1:1055`。直连局域网没有找到这台机器。部署走 `ssh home_server`。
- MySQL 别名 `lines` 是保留字，行数用 `nline`。
- `performance_schema` 要用 root。应用用户会 ERROR 1142。

重建后端：

```powershell
Set-Location D:\Coding\order-show
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --build backend
```

只重建 MySQL（缓冲池已经是 512MB，不要再做一次除非用户明确要求）：

```powershell
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --force-recreate mysql
```

## 压测怎么跑

脚本：`D:\Coding\h5订货会压测\h5订货会压测\h5_stress_test.py`。
默认活动是 HD20261029013，默认号池是干净池 `h5_phones_HD20261029006.json`。这两项都不能用默认值。

写号池：`h5_phones_HD20261029014_write.json`。键是 `customerId, customerType, note, phone, regionCode, used`。不要把号池或原始结果拷到 Mac，不要在输出里打手机号。

本轮结束时：干净池 1620 未用（综合 1072、特渠 548）。写号池已用 1157、空闲 463，空闲全是特渠。综合 1072 全部已用。服务器上有两份号池备份，文件名带 `bak-recycle-41`，里面是手机号，留在服务器。

公平复测必须用综合号。综合号不够时，只允许清 HD20261029014 的订单，然后只把对应写号池条目的 `used` 设回 false。HD20261029013 和干净池不动。删除顺序：`order_version_item`、`order_item`、`order_operation`、`order_change_request`、看板两张统计表、抽奖快照的 `qualifying_order_id` 置空、`order_version`、`h5_order_draft`、该订单的 ORDER 幂等行、`domain_event_outbox` 里 `aggregate_type='ORDER'` 的行，最后 `customer_order`。同一事务，`activity_id=14` 且 `customer_type='GENERAL'`。提交前确认活动 13 仍是 1500。`customerId` 对得上 `activity_customer.id`。`take()` 从文件头找未用号，所以要释放的综合号必须排在未用特渠号前面；本轮释放的是文件里综合段末尾 41 个（约下标 1031–1071）。

已验证的命令（在脚本目录，PowerShell）：

```powershell
$env:PYTHONIOENCODING="utf-8"
$env:PYTHONUNBUFFERED="1"
py -3 -u .\h5_stress_test.py --scenario s3 --duration 0 --steps 1,10,30 --act HD20261029014 --phones "D:\Coding\h5订货会压测\h5订货会压测\h5_phones_HD20261029014_write.json" --base http://127.0.0.1:18080
```

`--duration 0` 是每档只打一轮。不传则每档保持 120 秒。`s3` 走 `run_chain`。下单 PUT 和确认 GET 已经带 `includeHistory=false`。管理端看板页面要关着。`--no-persist` 不要用在写号池的正式轮次上，成功下单必须回写 `used`。失败且没落单的号会被 `release`。

`run_chain` 在 verify 失败时 `return`，却不调用 `barrier.wait()`。有一个号校验失败，其余线程会卡死。消费模式已经去掉这个屏障，下单链路没有。

报告在脚本目录，不要覆盖旧的并发报告，也不要改 `h5_concurrency_report_20261030.md`，除非用户要求。本轮报告：

- `h5_stress_s3_20261030_0237`：含特渠短单，不能当门
- `h5_stress_s3_20261030_0242`：仅代码、128MB、综合长单
- `h5_stress_s3_20261030_0244`：512MB、同一批综合长单

512MB、并发 30、综合长单的六步 P50/P95（毫秒）：page 447/575，verify 120/146，products 719/1052，draft 501/679，order 977/1203，confirm 336/453。各步是单次调用延迟。一个用户内部相加可以看链路，各档 P95 不能相加成墙钟时间。屏障等待不在统计里。

## 不要做的事

- 不要提交或推送，除非用户这次明确说。
- 不要动 HD20261029013，不要重置干净号池。
- 不要重启 Docker Desktop，不要加大 Docker 虚拟机内存。
- 不要动 homelab nginx、authelia、my_redis、my_postgres。
- 不要把 `innodb_flush_log_at_trx_commit` 改成 2。
- 不要再调池大小、准入、HTTP 线程。
- 不要打开 `DASHBOARD_SUMMARY_ENABLED`。
- 不要改订单控制器 `includeHistory` 的默认值。
- 不要删 `insertVersionItems`。
- 不要把价格档 LEFT JOIN 当成 bug。
- 不要在 Mac 上部署或灌数据。Mac 只改 `order_show` 代码。
- 不要把号池、原始压测 dump、数据库密码打到对话或拷到 Mac。
- 活动 14 的窗口过了就停止写入。

## 若用户还要继续追 1000ms

本轮批准的下一步，只有在用户再次要求时才做：收窄 `order_item` 的列。宽行插入和 `flush=1` 的 redo 仍在。512MB 把并发 30 的 P95 从 1541ms 降到 1203ms，P50 从 1131ms 降到 977ms，没有进门。

`docs/design/h5-concurrency-architecture-plan.md` 里的阶段二（内存定价、把 `loadProducts` 移出写事务）和阶段四（看板 CQRS）没有批准。阶段一里的刷盘改成 2 也没有批准。那份文档把阶段一预期写成 400–600ms，包含了被禁止的刷盘改动，不要拿来当验收。

并发 30 的商品查询 P95 在 512MB 时是 1051ms，不在下单门里，但整链仍然大约 2 秒。并发 50 和 200 不是门。
