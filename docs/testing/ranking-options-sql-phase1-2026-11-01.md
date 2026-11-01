# 排行筛选选项 SQL 优化（阶段一）· 2026-11-01

## 1. 问题

`GET /screen/activities/{code}/ranking/options` 在 5000 白名单 + 238 商品 + 4500 有效订单的规模下耗时数秒到十几秒。新版代码（`2da86b1`）引入的客户/商品联动筛选使其进一步劣化。

执行计划显示：目录分支把 **5000 个客户与 238 个商品做权限展开**，商品读取 loops=5000、分公司权限查找 loops 约 **119 万**，`EXPLAIN ANALYZE` 根节点约 21.6 秒。

## 2. 改动

`backend/src/main/java/com/fengyi/ordershow/dashboard/RankingStore.java` 的 `productScopes()`：

1. 新增 `customer_scopes` CTE，先把 `scoped_customers` 收敛为**去重的 (customer_type, region_code) 组合**。
2. 目录分支由 `JOIN scoped_customers c` 改为 `JOIN customer_scopes scope`，输出列改引 `scope`。
3. 原来的逐客户权限判定（分公司范围 / 经销商成员）改为**带 `LIMIT 1` 的相关标量子查询**：只要该 (客户类型, 大区) 组合下**存在一个**通过权限校验的客户，该商品即对该组合可见。

第 3 点是关键。半连接写法即使把客户分组，优化器仍可能把 `EXISTS` 拍平回客户×商品的连接（该写法已实测证伪：全部范围 19.4s、特渠 6.9s，反而更慢）。`LIMIT 1` 的相关标量子查询阻止了这一展开，权限分支调用从约 119 万次降到 **952 次**。

**语义未变**：原 SQL 对每个客户判权后 `SELECT DISTINCT` 输出 (客户类型, 大区, 项目组, 品种)；新 SQL 输出"该组合下存在可见客户"的组合。二者在 DISTINCT 后等价。有效订单中的历史商品名称仍从 `order_item` 分支产出，**不以当前商品目录替代订单快照**。

## 3. 等价性验证

### 3.1 独立临时库（覆盖权限分支）

先核查真实数据，发现**权限分支完全未被覆盖**：`customer_type='ALL'` 商品 0 个、有分公司范围限制的商品 0 个、有经销商范围限制的商品 0 个、经销商成员 0 条、空客户类型客户 0 条。因此另建独立临时库 `order_show_ranking_equiv_probe`（验证后已 DROP），构造：

- 商品：`ALL` 类型、仅综合、仅特渠、有分公司范围限制、有经销商范围限制、项目组为空
- 客户：不同分公司、不同大区、空客户类型、未填大区、`is_active=FALSE`
- 订单：覆盖上述商品，含礼盒行、空项目组行、`DRAFT` 状态单

7 个范围新旧 SQL **逐行一致**：

| 范围 | 行数 | 一致 |
|---|---:|---|
| 全部客户 | 22 | 是 |
| 综合客户 | 22 | 是 |
| 特渠专业客户 | 22 | 是 |
| 空客户类型 | 22 | 是 |
| 综合 + 指定大区 | 5 | 是 |
| 特渠 + 未填大区 | 4 | 是 |
| 全部 + 指定大区 | 5 | 是 |

等价性对比用的是**从改动后源码重新提取**的 SQL，确保落地的就是验证过的那一段。

### 3.2 真实数据 SQL 级 A/B

同一批真实数据（活动17），新旧 SQL 交替 5 轮，服务端计时，并比对结果 hash：

| 范围 | 结果 | 改动前 P50 | 改动后 P50 | 提速 |
|---|---|---:|---:|---:|
| 全部客户 | 211 行完全相同 | 5997.5ms | 1375.0ms | 4.36× |
| 综合客户 | 192 行完全相同 | 4048.8ms | 1280.8ms | 3.16× |
| 特渠专业客户 | 19 行完全相同 | 452.2ms | 134.5ms | 3.36× |
| 综合 + 指定大区 | 64 行完全相同 | 2727.9ms | 309.8ms | 8.81× |

### 3.3 HTTP 级多轮稳态 A/B

两个镜像（改动前 `2da86b1` / 改动后 `phase1`）各 5 轮，同客户端、同请求顺序，每次部署后等待 20 秒使 JIT 同等预热：

| 接口 | 改动前 P50 | 改动后 P50 | 改动前 P95 | 改动后 P95 |
|---|---:|---:|---:|---:|
| 排行筛选项 | 6342.8 | 1429.2 | 7555.6 | 2072.6 |
| 金额排行 | 831.1 | 728.5 | 970.0 | 951.9 |
| 吨数排行 | 807.3 | 795.3 | 1014.9 | 973.1 |
| 订单看板 | 2872.3 | 2726.0 | 3683.8 | 3707.6 |
| 战报 | 2537.8 | 2552.0 | 3218.1 | 2710.3 |

目标接口 P50 降 74%、P95 降 73%。

**关于看板 P95 (+23.8ms) 与战报 P50 (+14.2ms)**：这两个接口不调用被改动的 `productScopes()`（机制核对：`dashboard()` 调 reportProductLines/rankingRows/skuCount/orderTotals/regions/customerTypes/trend/generalRegions；`reports()` 调 reportProductLines/giftTypes/topCustomers/regions/customerTypes/generalRegions）。各轮变异系数 CV 在 4.2%–18.7%，14–24ms 远小于噪声（看板单轮实测从 2706.9ms 到 3707.6ms）。判定为测量噪声，非回归。

## 4. 构建与测试

- `mvn -DskipTests test-compile`：119 个主源文件 + 90 个测试源文件，BUILD SUCCESS。
- `mvn test -Dtest=DashboardServiceTest,RankingFilterTest,PageStatisticsControllerTest,DashboardSummaryCopyTest,DashboardSummaryWriteCostTest`：11 项通过，2 项按设计跳过（需独立 e2e 库），0 失败。
- 部署 kind（2 Pod × 2核4G）：2/2 就绪，7 个页面 200，readiness UP，CORS 六源正确，活动13/14/17 订单数与金额零变动。

## 5. 影响面与回退

- **不影响**下单写路径、订单数据、历史快照、其他看板接口、Flyway 迁移、运行参数。
- 回退方式：还原本文件即恢复原 SQL，无数据依赖、无迁移依赖。

## 6. 证据文件

`D:\order_show_validation\dashboard-probe-20261101-042913\`：`phase1-sql-ab.json`、`phase1-http-ab.json`、`phase1-equivalence-edgecases.json`、`build-phase1.log`、`deployment-patch-phase1.json`。

## 7. 未解决

订单看板（约 2.7s）与战报（约 2.5s）仍未优化。组件级计时显示二者 80% 以上时间花在 item 级全表扫描（659,412 行订单明细），需单独方案，见后续阶段。
