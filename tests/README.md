# 测试分层与运行方式

## 测试分工

- 旧活动 GET 清理：`ActivityRoutesTest` 验证真实 MVC 路由、旧地址 404 且不调用活动服务、`/current`/SSE/手机号验证/抽奖/后台活动路径保留；`ActivityInfoIntegrationTest` 追加完整 HTTP 栈的 404 验证并保留真实 SSE 更新/恢复验证。公开资料脚本与隔离 API E2E 改读 SSE 首帧；`public-activity-snapshot.test.mjs` 验证有界等待和断开清理。旧 `scripts/test-h5-entry.mjs` 改为依次运行现有手机号入口、活动 SSE 合成浏览器测试，不再保留旧 JSON 活动夹具或通道选择流程。详情见[清理验证](../docs/testing/retired-public-activity-2026-10-31.md)。

- 抽奖三种加权：`lottery-settings.test.mjs`验证指标与门槛联动、0门槛、名单复用和旧规则兼容；`LotteryWeightingTest`与`LotteryIntegrationTest`验证金额/箱数/吨数实际小计、零权重排除、真实开奖和审计对账。千人在线、200单/分钟的同流量对照见[加权验证记录](../docs/testing/lottery-weighting-2026-10-31.md)。测试不构建或部署业务镜像。

- H5 本机草稿与抽奖按页面加载：`h5-local-draft.test.mjs` 验证浏览器持久化、隔离、损坏/过期和存储失败；`h5-manual-refresh.test.mjs` 验证完整草稿生命周期及后台更新后的失效、提交成功清理/失败保留。`activity-info-stream.test.mjs` 与 `lottery-board.test.mjs` 分别保证公共/H5 初始化不查询抽奖，以及抽奖页独立读取正常。`scripts/test-h5-manual-refresh-browser.mjs` / `scripts/test-activity-info-browser.mjs` 使用真实组件和合成 HTTP 验证本机恢复、无草稿/抽奖请求及活动 SSE 兼容；见[验证记录](../docs/testing/h5-local-draft-2026-10-31.md)。

- 手机端订单按需刷新：`h5-manual-refresh.test.mjs` 覆盖无轮询、15 秒冷却、共享查询、修改/撤回检查、审核及后台直接修改、草稿版本和迟到响应隔离；`scripts/test-h5-manual-refresh-browser.mjs` 使用真实 H5 组件及合成 HTTP，在手机/桌面验证静置无订单请求、最新购物车和失败恢复，见[验证记录](../docs/testing/h5-manual-refresh-2026-10-30.md)。

- 后台手动刷新：`admin-manual-refresh.test.mjs` / `admin-session.test.mjs` 覆盖按需读取、请求合并、过期响应隔离和身份异常；`scripts/test-admin-refresh-browser.mjs` 用真实后台组件与合成 HTTP 在桌面/窄屏验证静置无轮询、手动刷新及失败恢复，详见 [后台取消轮询验证](../docs/testing/admin-manual-refresh-2026-10-30.md)。

- `rendered-html.test.mjs`：运行构建后的服务端入口，检查实际 HTML 与必要资源。
- `product-project-filter.test.mjs`：项目组动态选项、组合筛选、空值、分页与勾选重置、全选范围及只读列表；`scripts/test-product-project-filter-browser.mjs` 使用合成数据挂载真实商品表格与样式，验证 React 生命周期和宽窄布局，不访问业务接口。运行方式见 [项目组筛选验证说明](../docs/testing/product-project-filter-2026-10-27.md)。
- `admin-*.test.mjs`、`workspace-orders.test.mjs`、`h5-flow.test.mjs`、`screens.test.mjs`：验证业务计算、操作结果、组件渲染及部分状态行为。其中 Hook 操作测试使用显式状态适配器，不能代替真实 React 浏览器生命周期测试。
- `source-contracts.test.mjs`：保留的源码、迁移和接口文档约束检查。它们不是运行时覆盖率；本轮移除了一批已有行为测试覆盖的函数名和实现细节断言。后续需求优先增加行为测试，再按覆盖情况逐项替换剩余源码约束。
- `backend/src/test`：Java 单元、接口契约和隔离 API E2E。
- 排行上限回归：`admin-activity.test.mjs` 检查新建 90/30 与修改时保留自定义配置；`screens.test.mjs` 检查两种排行的 22/90 人完整渲染和全部/特渠/综合各大区参数。Java `RankingDatabaseIntegrationTest` 在独立 MySQL 上执行生产 SQL，覆盖 0/20/22/89/90/91 人、公司 90/分公司 30、排序、先筛选再取前 N 名、撤回/作废排除、缺失/部分/零吨数、自定义上限和历史快照重建。它只在 `ORDER_SHOW_RANKING_TEST=order-show-e2e` 时运行，固定使用测试端口 33306 的 `order_show_ranking_test`，不访问业务库。
- `time.test.mjs`、`time-monitoring.test.mjs`、Java `UtcTimeConfigurationTest` / `UtcDatabaseIntegrationTest` 及审核 API E2E：覆盖北京时间展示与表单转换、UTC 数据库默认值、跨 JVM/浏览器时区、审核时间一致性、Excel 导出及负通知延迟。真实浏览器运行 `scripts/test-time-browser.mjs`，见 [时间回归说明](../docs/testing/utc-time-2026-10-19.md)。
- 本地历史校正工具及配套 3 项测试已按用户要求移出项目并归档，不再属于常规测试入口。已执行的真实历史副本校正/回退、实际 Excel、新申请审核和三个浏览器时区结果保留在 [历史时间回归](../docs/testing/time-history-2026-10-19.md)。
- `scripts/browser-regression.mjs`：真实浏览器关键流程，包括活动切换、H5、管理员订单编辑、大屏筛选、趋势交互和响应式布局。
- `scripts/test-manual-additions.mjs`、`scripts/test-manual-additions-browser.mjs`：隔离环境实际新增白名单/商品/到场人员、错误提示和部分保存回归；后者使用前者生成的合成夹具。具体运行方式见 [2026-10-19 回归记录](../docs/testing/manual-additions-2026-10-19.md)。

## 运行

本地前端检查使用 `npm test`、`npm run typecheck`、`npm run lint`。类型检查同时禁止无用局部变量和参数。`tsconfig.tsbuildinfo` 是可再生成的缓存，不应提交。

完整隔离检查使用 `scripts/run-automated-tests.ps1 -KeepEnvironment`，它创建专用测试栈并执行前后端测试。随后设置 `ORDER_SHOW_E2E=order-show-e2e`，运行 `node scripts/browser-regression.mjs`。Playwright 可安装在本机，或通过 `ORDER_SHOW_PLAYWRIGHT_MODULE` 指定已有的 `playwright/index.mjs` 文件 URL。

`browser-regression.mjs` 使用固定的 3100/8180 测试端口，依赖 API E2E 生成的夹具，会创建/修改订单及截止测试活动，整套复跑前须重新生成隔离数据，完成后用 `scripts/test-env.ps1 reset` 清理。H5 手动刷新和活动 SSE 两个前端浏览器脚本分别使用 4188/4189，全部 HTTP 为合成夹具，不连接业务 API 或数据库，结束后自行关闭浏览器及测试服务。

当前结果和未覆盖范围见 `docs/testing/refactor-regression-2026-09-07.md`。通过测试不代表此前记录的客户名称标准化缺陷已被修复，也不代表压测、灾备和全部浏览器兼容性已验收。

排行专项数据库测试先启动 `docker compose --project-name order-show-e2e --file docker-compose.test.yml up -d mysql-test`，然后运行：

```powershell
docker run --rm -e ORDER_SHOW_RANKING_TEST=order-show-e2e `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 `
  mvn -f backend/pom.xml '-Dtest=DashboardServiceTest,RankingDatabaseIntegrationTest,ActivityRankingValidationTest' test
```

完整隔离检查脚本 `scripts/run-automated-tests.ps1` 也已开启排行数据库专项。完成后使用 `scripts/test-env.ps1 reset` 清理独立测试环境。排行修复实测与部署边界见 [排行修复记录](../docs/deployment/2026-10-27-ranking-limits.md)。

## 性能测试

抽奖手动试算、项目组/品种联动和吨数专项见 [抽奖验证记录](../docs/testing/lottery-manual-preview-2026-10-31.md)。`lottery-settings.test.mjs` 验证进入/修改/切轮不计算、手动仅当前轮、名单复用及过期请求取消。`LotteryIntegrationTest` 在固定端口33316的专用临时库验证真实SQL、旧规则升级、匹配小计、吨数、批量快照和失败回滚；只在 `ORDER_SHOW_LOTTERY_TEST=order-show-lottery-test` 时运行。`LotteryAdmissionFilterTest` 和 `LotteryQueryTimeoutTest` 验证并发隔离、许可释放和单查询超时。

`tests/load/lottery-event-runner.mjs` 使用现有运行镜像挂载优化前后临时JAR，固定 `order-show-load-lottery` 项目、8680端口和合成库，对比每分钟100/200单时只下单、原抽奖和优化后抽奖。它会重建并最终清理该专用测试库及卷；不接受业务环境变量或业务数据库地址，不由常规测试自动执行。

手机号优先登录专项见 [本地验证记录](../docs/testing/h5-phone-first-2026-10-30.md)：`tests/phone-verification.compose.yml` 使用专用无宿主端口 MySQL 合成库，`ORDER_SHOW_PHONE_BENCHMARK=true` 才开启服务级性能对照；`scripts/test-h5-phone-entry-browser.mjs` 用实际组件和模拟 HTTP 验证手机/桌面弹窗，不连接业务 API。本轮不部署业务服务。

看板汇总层新增 V040、原查询差分测试、逐单回填/对账和专用压测。执行入口、隔离库、迁移权限、按活动开关及结果见 [汇总层验收记录](../docs/testing/dashboard-summary-2026-10-29.md)。默认不启用汇总读取；本次代码交付不代表部署。

独立压测环境使用 `docker-compose.load.yml`，项目名 `order-show-load`，后端端口8280。
启动、生成数据、执行k6/SSE及清理方法见 [load/README.md](load/README.md)。
执行范围见[性能计划](../docs/testing/performance-test-plan.md)，本机实测与未验收项见[性能报告](../docs/testing/performance-test-report.md)。
性能测试不由 `npm test` 自动启动，避免常规回归意外产生高负载。

## 部门成员权限（2026-10-07）

- 新增权限、私有文件下载、导航和初始化行为测试；活动概览成员只读，订单独立权限支持商品及客户选择。
- 隔离后端启动后运行 `node scripts/test-department-members.mjs`。脚本固定访问 8180，创建独立测试部门和账号，验证六项权限、跨部门隔离、成员管理范围、商品/白名单导入、手动到场、订单创建/审核/作废、改名后的身份快照、收权以及密码/停用会话失效。
- 此脚本已接入 `scripts/run-automated-tests.ps1`，在 Java E2E 后执行。验证数据均为脚本内合成数据，不读取业务 Excel。
- 本次通过前端构建、类型检查、lint、126 项既有及新增前端行为测试、3 项补充导航渲染测试、Java 单元/契约测试及 10 项原有 API E2E；成员脚本通过 142 项 API 状态断言及身份/数据断言。V035 在隔离 MySQL 上迁移成功。
- 本次没有可用浏览器连接，未完成真实浏览器视觉及交互验收；组件静态渲染测试不等同于浏览器验收。

成员使用规则及账号边界以 [项目规则](../PROJECT.md)、[权限矩阵](../docs/design/05-security-concurrency-audit.md) 和 [ADR-009](../docs/design/adr/ADR-009-department-shared-account-isolation.md) 为准。专项验收同时发现并修复了手动新增到场人员 SQL 占位符数量错误，成员实际补录接口已通过验证。当前本地部署状态及迁移备份见 [根 README](../README.md)。
