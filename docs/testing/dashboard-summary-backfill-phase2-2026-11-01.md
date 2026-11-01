# 看板读路径优化（阶段二）· 汇总读模型回填 · 2026-11-01

## 1. 为什么选这条路

阶段一后，组件级计时显示剩余的慢点集中在 item 级全表扫描：

| 组件 | 耗时 | 性质 |
|---|---:|---|
| reportProductLines | 1888ms | 扫 659,412 行订单明细 |
| rankingRows | 1293ms | 同上 |
| giftTypes | 1155ms | 同上 |
| skuCount | 290ms | 同上（走覆盖索引） |
| orderTotals / regions / customerTypes / trend / topCustomers | 168–213ms each | order 级，不是问题 |

看板 **82.8%**、战报 **80.2%** 的时间都花在读这 659,412 行明细上。订单级查询每项仅约 200ms，无需优化。

### 已实测证伪的方向

**合并重复扫描**：把 reportProductLines / giftTypes / skuCount / order_tons 合并成一条 SQL。实测**更慢**：

| 方案 | 耗时 |
|---|---:|
| 三个查询分别执行 | 3733ms |
| 合并成一条 SQL | 4064ms |

原因是 MySQL 并未把 `line_items` 物化一次，执行计划里出现 **3 次** `order_item` 访问。进一步用 `/*+ NO_MERGE(line_items) */` 强制不合并，仍是 3 次访问、3579ms，没有收益（该构建也不支持 `AS MATERIALIZED` 语法）。**此方向已否决，未进入代码。**

**order_item 加覆盖索引**：单次扫描内部构成是"读行 939ms + 分组 624ms"，覆盖索引只能优化前者，且要在热写表上加大索引。风险最高，未采用。

## 2. 实际做法

仓库里**早已存在**汇总读模型（`order_dashboard_stat`、`order_dashboard_product_line_stat`）和读取切换（`DashboardSummaryStore.lineSource/tonsSource`），`DashboardSummaryStore` 的类注释也写明它是"一次性读模型，绝不改变订单、历史或历史看板快照"。缺的只有两件事：

1. `DASHBOARD_SUMMARY_ENABLED` 开关（默认 false，K8s ConfigMap 中此前也未配置）
2. 汇总数据回填（活动17 覆盖率为 **0/4500**）

> 注意：`DashboardSummaryStore.refresh()` 开头有 `if (!enabled) return;`，因此**回填必须在开关打开后执行**，顺序不能颠倒。

本次操作：
- ConfigMap 增加 `DASHBOARD_SUMMARY_ENABLED=true`（一个环境变量，可回退）
- 用系统自带 CLI `DashboardSummaryCommand rebuild 17` 回填（每批 200 单自动循环）
- 该 CLI 不启动 HTTP、调度器、Flyway 或任何 bootstrap 例程

**没有修改任何一行 Java 代码。** 汇总读模型的行为完全由既有代码决定。

回填结果：`checked=4500 differences=0`，用时 60.9 秒；汇总行 4500/4500，`order_dashboard_product_line_stat` 27,000 行（对比明细 659,412 行，**减少 24.4 倍**）。

## 3. 一致性验证

### 3.1 官方 check（只读比对汇总 vs 明细）

`DashboardSummaryCommand check 17`：`checked=4500 differences=0`。该命令逐单比对 item_count、all_tons、eligible_tons 以及按 (product_line, is_gift_box) 分组的金额与数量。

### 3.2 API 输出 vs 数据库直算

| 字段 | API | 数据库直算 | 一致 |
|---|---:|---:|---|
| order_count | 4500 | 4500 | 是 |
| total_amount | 66951266.54 | 66951266.54 | 是 |
| total_quantity | 659412 | 659412 | 是 |
| sku_count | 234 | 234 | 是 |
| total_tons | 2774.240748 | 2774.240748 | 是 |
| 战报 total_amount | 66951266.54 | 66951266.54 | 是 |
| 礼盒·综合 金额 | 6533207.0 | 6533207.00 | 是 |
| 礼盒·综合 订单数 | 3173 | 3173 | 是 |
| 礼盒·特渠 金额 | 6175194.5 | 6175194.50 | 是 |
| 礼盒·特渠 订单数 | 1327 | 1327 | 是 |
| 综合项目组·调味油 | 29932939.72 | 29932939.72 | 是 |
| 综合项目组·酱油 | 17320074.34 | 17320074.34 | 是 |
| 综合项目组·醋 | 8531245.1 | 8531245.10 | 是 |

### 3.3 既有单测

阶段一提交时已跑过 11 项通过（含 `DashboardServiceTest`、`PageStatisticsControllerTest`、`DashboardSummaryCopyTest`、`DashboardSummaryWriteCostTest`）。阶段二未改代码，无需重跑。

## 4. 读路径提升（HTTP，5 轮）

| 接口 | 回填前 P50 | 回填后 P50 | 提升 |
|---|---:|---:|---:|
| 订单可视化看板 | 2872.3ms | **305.8ms** | **9.4×** |
| 战报 | 2537.8ms | **165.0ms** | **15.4×** |
| 金额排行 | 831.1ms | **74.5ms** | **11.2×** |
| 吨数排行 | 807.3ms | **71.2ms** | **11.3×** |

叠加阶段一后，排行筛选项为 1429.2ms。五个看板接口全部从"秒级"进入"百毫秒级"。

## 5. 写路径代价（30 并发一波，特渠 45 行/单）

| 指标 | 开关关闭（阶段一基线） | 开关打开 |
|---|---:|---:|
| 成单数 | 30/30 | 30/30 |
| order P95（客户端） | 2088.1ms | 1680.1ms |
| write 段 P95（服务端） | 700.2ms | 979.0ms |
| commit 段 P95（服务端） | 98.7ms | 59.0ms |
| pre_commit_total P95 | — | 1397.0ms |
| total P95（服务端） | 1486.7ms | 1411.2ms |
| 错误 | 0 | 0 |

**写代价很小且在噪声范围内**：服务端 total P95 反而略低（1411 vs 1487），write 段 P95 上升约 279ms 但 commit 段下降约 40ms，整体相互抵消。30 单全部成功，汇总行自动维护到 4530/4530，`dirty` 行数保持 72（属于活动14 的历史遗留，未触碰）。

## 6. 影响面与回退

- **代码零改动**，仅新增一个环境变量 + 一次数据回填。
- 回退方式：ConfigMap 去掉 `DASHBOARD_SUMMARY_ENABLED` 即恢复原读路径（汇总数据可保留，不影响任何结果）；如需彻底清除，删除两张汇总表中活动17 的行即可。订单、明细、历史快照均不受影响。
- 活动13（1501 单）与活动14（1016 单）全程未改动；活动17 从 4500 增至 4530 单（本轮 30 笔授权测试单）。

## 7. 未解决 / 后续

- **admin 活动概览**（`/admin/activities/{id}/overview`）需要管理员会话，本轮未测。其 `totalTons` 单项此前实测 940ms，走的是同一条汇总路径，预期同样受益，但**尚未验证**。
- **多人/多屏同时打开**时的重复计算未解决（读路径虽快 10 倍，但每个请求仍会独立计算）。如需进一步压并发，可考虑有界结果缓存 + 请求合并。
- 冷启动场景未重测。

## 8. 证据文件

`D:\order_show_validation\dashboard-probe-20261101-042491` 同级目录 `dashboard-probe-20261101-042913\`：
`phase2-component-cost.json`、`phase2-write-cost.json`、`phase2-write-cost-wave.json`、`phase2-correctness.json`、`backfill-cli-log.txt`、`backfill-check-log.txt`、`backfill-job.yaml`、`patch-summary-on.json`、`backup-before-phase2.json`。
