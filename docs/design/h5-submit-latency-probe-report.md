# H5 下单 30 并发 < 1000ms:事务内分段探测报告

日期：2026-10-29（压测时刻约 20:14–20:48 UTC）。
代码仓库：`/Users/didi/workspace/order_show`。本文件未提交。
承接 `h5-submit-latency-handoff.md`。门的定义以 handoff 为准：**暖机后并发 30、综合客户、约 170 行，下单 PUT P50 与 P95 都 < 1000ms，err=0**。

---

## 1. 结论（先说要点）

- **暖机后并发 30 过门，且稳定。** 5 轮暖机态下单 PUT P95 = 782 / 778 / 857 / 676 / 692 ms，全部 < 1000ms，err=0。
- **根因不是数据库。** 事务内耗时从并发 50 到并发 200 几乎不变（total P95 约 400–490ms），客户端延迟却从 1030ms 涨到 4638ms。瓶颈在事务**之外**：HTTP 线程池 / 连接池 / 准入信号量的排队 + 约 65KB 响应序列化 + 网络。此前两轮 agent 都没测到这段。
- **DB 内第一成本是 write（宽表插入），不是 fsync、也不是读。** 暖机稳态 write P50 约 184–193ms，commit(fsync) 约 38–43ms，read_products 约 50–53ms。
- **本轮唯一代码外优化：JDBC `rewriteBatchedStatements=true`**（原来缺失）。write P50 从 227→184ms（约 −19%）。温和改善，不是决定性的。
- **margin 偏薄且有冷启动尖峰。** 暖机态 857ms 已逼近门；后端刚重建的冷启动轮 P95 = 1536ms（不在门内，但真实开场会遇到）。

---

## 2. 做了什么

### 2.1 测量（零行为变化）
`OrderService.submit` 内加分段计时，一行 ASCII 日志 `h5.submit.timing`，七段：
`preflight`（锁+幂等begin+锁单+读旧量）/ `read_products`（事务内 loadProducts）/ `calc`（内存算价）/ `write`（明细+版本+operation+outbox）/ `readback`（orderAfterSubmission 回读）/ `idem_complete`（幂等写）/ `commit`（事务提交 fsync，经 TransactionSynchronization 在提交后捕获）。
不改方法签名、不注入依赖、不改任何测试。33 个相关单测全绿。

### 2.2 优化
`docker-compose.yml` 的 `DB_URL` 追加 `rewriteBatchedStatements=true`，`--no-deps --force-recreate backend`。
不碰 flush（仍为 1）、不碰缓冲池（仍 512MB）、不碰连接池/准入/HTTP 线程。安全性核对：`insertItemBatches` 注释明确不取 generated keys；`insertVersion` 是单条 + RETURN_GENERATED_KEYS、不走 batch，不受影响。

---

## 3. 分段数据（毫秒）

### 3.1 优化前后对比（暖机态，公平可比）

| write 段 | 优化前（OFF, 30 样本） | 优化后（ON, 90 样本稳态） | 收官（ON, 30 样本） |
|---|---|---|---|
| P50 | 226.9 | 193.4 | 184.1 |
| P95 | 276.8 | 344.3 | 212.3 |

P50 稳定下降约 19%。P95 在 90 样本轮偏高是样本量差异（吃到更多尾部），非回退。

### 3.2 收官轮暖机 c30 分段（30 样本，最终稳态）

| 段 | P50 | P95 |
|---|---|---|
| preflight | 18.5 | 49.0 |
| read_products | 53.3 | 76.5 |
| calc | 0.1 | 0.2 |
| **write** | **184.1** | **212.3** |
| readback | 9.5 | 21.1 |
| idem_complete | 3.0 | 9.8 |
| **commit (fsync)** | 38.0 | 62.3 |
| **事务内 total** | **319.8** | **371.1** |

客户端下单 PUT 同轮 P50 583.7 / P95 691.7。**客户端 − 事务内 ≈ 320ms** 的差值即"黑洞"。

### 3.3 阶梯极限（暖态，事务内 vs 客户端）

| 并发 | 事务内 total P95 | 客户端下单 P95 | 黑洞(差值) | products读 P95 | err |
|---|---|---|---|---|---|
| 30 | 371 | 692 | ~320 | 244 | 0 |
| 50 | 401 | 1030 | ~630 | 664 | 0 |
| 100 | 493 | 2307 | ~1810 | 1439 | 0 |
| 200 | 414 | 4638 | ~4220 | 2580 | 0 |

**事务内几乎恒定，客户端随并发爆炸，黑洞线性吞掉全部增量。** 这是"DB 不是高并发瓶颈"的铁证。全程 err=0，系统不倒，是延迟恶化而非崩溃。

---

## 4. 根因

1. **高并发瓶颈在事务外的黑洞**，成分：
   - **HTTP 线程池 = 60**：并发 100/200 时请求在 Tomcat 队列排队。
   - **连接池 = 60、准入信号量 = 36**：提交与 products 读争抢连接；并发 > 36 时写请求在准入处排队。
   - **约 65KB 响应序列化**：OrderView 含约 170 个 ItemView × 20 字段，序列化在控制器返回后由 Spring 完成，落在事务计时之外。
   - 请求体反序列化 + 局域网传输。
2. **DB 内第一成本是 write**（`order_item` 170 行 × 26 列宽表批量插入），第二是 commit(fsync，flush=1 不可改)，第三是事务内 read_products。
3. **冷启动尖峰（1536ms）源于后端侧冷**：MySQL 缓冲池全程热（没重建 MySQL），冷的是重建后的后端 JVM（JIT 未编译）+ Hikari 连接建立 + 预编译语句缓存空。现有 `H5StartupWarmup` **只预热读路径，没预热写路径**。

---

## 5. 下一步（按杠杆排序，均在 handoff 规则内）

1. **收窄 `order_item` 列（handoff 已批准方向，阶段三）** —— 现在有数据背书：write 是 DB 内最大段。把 26 列的展示性冗余字段（品名/品类/品牌/规格/图片key 等）剥离，宽行插入体积可降约 75%，直接压 write 段。这是真正的 DB 杠杆。
2. **把写路径纳入 `H5StartupWarmup`** —— 消除 1536ms 冷启动尖峰（门虽不含冷启动，但真实开场会遇到）。规则内、不改池/线程。
3. **响应瘦身** —— 下单 PUT 的响应不必回传全部 170 个 item 的 20 字段（前端可由 activity_product_id 本地映射展示字段）。直接砍黑洞里最大的可控项。属阶段三"静态展示元数据解耦"的自然延伸。
4. **若要扛并发 50+**：HTTP 线程/连接池/准入是线性瓶颈——但这些在 handoff 禁改清单内，需用户另行批准才动。并发 50/100/200 本就不是当前的门。

---

## 6. 本轮对生产的改动与数据安全

- **全库逻辑备份**：`order-show-mysql-1:/tmp/order_show_backup_pre_release41.sql` 及宿主机 `D:\Coding\order_show_backup_pre_release41.sql`（490MB，mysqldump --single-transaction）。
- **代码**：`OrderService.java` 加分段日志（Mac 工作区 + 服务器镜像）；服务器原文件备份为 `OrderService.java.bak-timing`。
- **配置**：`docker-compose.yml` DB_URL 加 `rewriteBatchedStatements=true`；原文件备份为 `docker-compose.yml.bak-rewritebatch`。
- **释放的综合号**：两次带断言事务删除活动 14 的 GENERAL 订单，共 541 次删除、涉及 unique 客户 id 19951–20450（500 个）。第一次删 id 20410–20450（41 单），被首轮压测重新下单；第二次删 id 19951–20450（500 单，含被重新下单的那 41）。两次区间重叠即因此。活动 13 全程 = 1500 未触及。对应写号池条目 `used` 置回 false 后已被本轮压测全部消耗（当前空闲综合号 = 0）。号池原文件备份为 `h5_phones_HD20261029014_write.bak-release41.json`。
- **未改**：flush=1、缓冲池 512MB、连接池/准入/HTTP 线程、看板汇总开关、活动 13、干净号池、homelab 容器、Docker Desktop。未 commit、未 push。
