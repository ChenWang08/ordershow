# 页面统计查询拆分（2026-10-31）

## 范围

本轮仅拆分页面统计读取职责，保留当前业务口径、客户类型显示和手动刷新方式。没有新增数据库迁移，没有修改订单提交、审核、调价、吨数维护、汇总更新或抽奖业务；没有部署、推送或更新业务服务。

| 页面 | 统计接口 | 只加载的内容 |
| --- | --- | --- |
| 活动概览 | `/admin/activities/{id}/overview`（新增） | 金额、单数、箱数、吨数、分类提交数、当前有效发布白名单人数 |
| 排行大屏 | `/screen/activities/{code}/ranking` | 当前筛选的公司/分公司排行、基础总计、数据版本 |
| 订单看板 | `/screen/activities/{code}/dashboard` | 指标、客户类型、大区、项目组、小时趋势、两组 TOP15 |
| 专题战报 | `/screen/activities/{code}/reports/{reportCode}` | 九类专题共同需要的金额、项目组、大区、礼盒、客户 TOP5 |

活动概览由三次 ranking 加一次 module-context 改为一次 overview；前端仅调整这一数据接线，没有界面改造。概览仍需点击“刷新统计”；三个大屏仍首次加载、之后手动刷新，专题本地切换不重复请求。公开活动基础信息及抽奖初始化不属于本轮优化。

## 共享和兼容边界

- `PageStatisticsService` 分别组装四种页面需要的查询；`DashboardService` 中抽出的金额汇总、排行、项目组等基础查询可复用，但实时页面不调用旧版整套 ranking/report 组装。
- 原始明细与汇总读取开关、缺失/dirty 汇总的逐单回退保持不变。总吨数使用 all_tons；吨数榜的有效系数规则不变。TOP15/TopN 不限制总计范围。
- 保留现有响应外层结构。排行不计算 SKU、项目组和最近订单；看板不计算礼盒和专题客户 TOP5；战报不计算完整排行、SKU、趋势和总吨数。兼容列表字段保留为空数组，战报 totals 仅保留页面使用的 total_amount。接口文档已标注这些差异，外部自建调用方若读取上述非页面字段，需在部署前核对。
- 历史活动继续读取已有 RANKING/REPORT 冻结快照并裁剪返回字段，避免历史数据随本次拆分重算。旧快照缺失时仍沿用既有补建逻辑，因此历史首次补建可能执行旧整套查询；这不是实时概览继续请求 ranking 接口。FINISHED 更新、ARCHIVED 冻结、重新开放清除快照的机制不变。
- 旧后台 `/ranking` 保留兼容，不再由概览调用。`module-context` 仍供白名单、到场等模块使用，不删除。
- 每个页面读取使用 REPEATABLE_READ 事务；概览订单统计、吨数和白名单人数来自同一个数据库视图。历史概览仍按原规则组合冻结订单统计与当前有效白名单人数。
- 新概览接口保留登录、部门隔离及 OVERVIEW 模块权限，不向只有订单权限的成员开放。

## 客户类型与统计口径

保留综合、特渠、双类型、不区分四种看板布局。优先按有效白名单提供的活动客户类型决定显示；双类型活动只有一类提交或尚无订单时，不因此变成单类型布局。综合大区、项目组颜色、TOP15、趋势宽度及不区分类型的“全部客户”不变。

概览只统计 SUBMITTED 订单；撤回、作废不计入。有效发布白名单人数排除停用、旧版本及其他活动。ALL 筛选表示不限制类型，不等同于只查存储类型 ALL。空大区、未配置大区、空项目组与实际“其他”项目组沿用原 SQL 处理。

## 验证方法

新增 `PageStatisticsIntegrationTest` 在独占的隔离测试库中对照 `DashboardBeforeSummaryReference` 原 SQL：96 笔订单、每笔 180 项及另一活动数据，叠加撤回/作废、无明细、缺失系数、零吨数、旧大区等边界。

覆盖明细读取、汇总缺失/部分/dirty、金额/吨数排行与筛选、四类客户模式、零有效订单、九类专题、旧格式快照、历史更新和重新开放。并发测试在统计请求中途由另一事务提交订单/明细/白名单变化，确认一次概览不会混合前后两个视图。

查询次数统计在 JdbcTemplate 实际执行层计数，排除内部重载转发造成的重复记录。统计范围为核心统计 SQL，不包含活动元信息、身份和权限查询；旧概览还额外需要 module-context 查询。只验证本地查询裁剪，不把查询次数下降等同于线上延迟同比下降，也不作为容量压测结论。

验证结果和具体查询次数见下节。

## 本地验证结果

| 页面 | 旧核心 SQL 次数 | 新核心 SQL 次数 |
| --- | ---: | ---: |
| 活动概览 | 18（仅三次 ranking，不含 module-context） | 3（已包含白名单人数） |
| 排行大屏 | 6 | 3 |
| 订单看板 | 13 | 9 |
| 专题战报 | 13 | 9 |

- 前端 318 项测试通过，包含新增概览单请求/单类型/不区分类型，以及看板四种客户类型在无订单和只有一类提交时的显示断言。
- 类型检查、生产构建、本次修改文件 ESLint 通过；构建保留原有部分资源包超过 500 kB 的提示。
- 真实组件 + 合成 HTTP 浏览器测试在 1440px/440px 通过：首次概览不请求统计，手动刷新只调用 overview，不调用 ranking/module-context；模拟静置 65 秒不轮询、切换模块、503 保留数据和整页重置正常。
- SQL 对账、旧快照兼容、并发视图一致性及查询次数断言通过。一次未充分预热的采样中概览用时 67.78→91.90ms，其余页面下降；受首次执行与测试环境影响，不能宣称所有接口实际延迟已经改善。稳定收益证据是减少无关 SQL，线上延迟需部署后单独测量。
- 后端完整测试命令成功：260 项中 203 项通过、57 项因未启用对应集成/压测条件跳过，0 失败；其中新页面数据库测试 5 项、路由及访问检查 2 项通过。另单独启用原有金额/吨数榜数据库测试，10 项全部通过。没有执行全链路 HTTP E2E 或容量压测，不能把跳过项记为通过。

## 复跑

```powershell
pnpm typecheck
pnpm build
node --test tests/*.test.mjs
$env:ORDER_SHOW_PLAYWRIGHT_MODULE='file:///C:/Users/Chen/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
node scripts/test-admin-refresh-browser.mjs
docker compose -f docker-compose.test.yml up -d --wait mysql-test
docker run --rm -e ORDER_SHOW_SUMMARY_TEST=order-show-e2e -v order-show-m2:/root/.m2 -v E:\fengyi\order_show:/workspace -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml test
docker run --rm -e ORDER_SHOW_RANKING_TEST=order-show-e2e -v order-show-m2:/root/.m2 -v E:\fengyi\order_show:/workspace -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml "-Dtest=RankingDatabaseIntegrationTest" surefire:test
```

数据库测试只连接固定 33306 端口下的专用测试实例，重建其固定 `order_show_summary_test` 测试库，不接受业务库地址。浏览器测试使用合成接口，不连接业务服务。
