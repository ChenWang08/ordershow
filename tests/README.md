# 测试分层与运行方式

## 测试分工

- 订货排行布局（2026-11-04）：仅运行排行组件/刷新22项和筛选联动4项，共26项通过；`scripts/test-ranking-filters-browser.mjs`验证四层布局、原字号、1920×1080/2560×1440/1366×768下90名完整显示及相关筛选、刷新、失败恢复、弹层和滚动访问。无后端改动、整站构建或镜像部署，见[定向验证记录](../docs/testing/ranking-layout-2026-11-04.md)。

- 后台订单/审核加载（2026-11-04）：`order-loading.test.mjs` 及订单、审核、手动刷新、导出、活动只读相关测试共58项通过；`scripts/test-order-loading-browser.mjs` 通过真实组件与合成HTTP核对1440/440宽度的分页、失败独立恢复、审核入口、通过/驳回及新增/调整/作废后的请求次数。后端订单/权限相关43项和隔离MySQL的3项查询测试通过；类型检查使用 `tests/order-loading.tsconfig.json`。测试数据库通过 `docker compose -p order-query-test -f tests/order-query.compose.yml up --abort-on-container-exit --exit-code-from test` 启动，用完执行同项目前缀的 `down`；无业务数据库或业务服务部署，详见[完整记录](../docs/testing/order-list-loading-2026-11-04.md)。

- 导入防重复点击（2026-11-04）：运行`node --test tests/import-busy.test.mjs tests/admin-products.test.mjs tests/admin-customers.test.mjs`，58项通过，其中新增11项验证快速连点、解析/上传/发布/正式列表读取期间的互斥、失败后恢复，以及真实组件静态渲染中的按钮和文件输入禁用。使用可控异步请求和Hook状态适配器，不代表真实浏览器或数据库写入验收；本次未构建或部署镜像，详情见[定向验证记录](../docs/testing/import-busy-2026-11-04.md)。

- 后台三份列表加载（2026-11-04）：`admin-list-cache.test.mjs`、`admin-product-images.test.mjs`、`admin-lazy-loading.test.mjs`、`admin-products.test.mjs`、`admin-customers.test.mjs` 和 `drawer-interactions.test.mjs` 共77项通过；`scripts/test-admin-list-loading-browser.mjs` 通过真实组件与合成接口验证保存/取消不整表重读、分页筛选保留、手动刷新、返回加载和候选缓存失效。`ProductEditorStateTest` 与权限/图片专项覆盖局部读取和边界；完整结果、原有失败及未部署范围见[验证记录](../docs/testing/admin-list-loading-2026-11-04.md)。

- 活动写入保护启动顺序：`ActivityWriteStartupTest` 在同一33326端口临时库验证正式配置、Spring Boot连接池/Flyway/监控初始化、完整Bean处理及两组连接池参数。配合活动写入保护、H5路径回滚、草稿/导入事务及订单提交专项复测；修复前后证据、复跑命令及未部署边界见[启动顺序修复记录](../docs/testing/activity-write-startup-2026-11-03.md)。沿用 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only` 开关，禁止与使用同库的生命周期测试并行运行。

- 活动归档与永久删除：`npm run test:activity-lifecycle`、`npm run typecheck:activity-lifecycle` 和 `scripts/test-activity-lifecycle-browser.mjs` 验证原活动菜单筛选、超管操作、归档订单只读及删除进度。`ActivityLifecycleIntegrationTest` 使用固定33326端口临时库，只有 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only` 才启用，覆盖真实迁移、关联数据分批清理、续跑、失败重试、锁、缓存隔离及草稿/导入事务兼容；`StorageDeletionTest` 验证文件及衍生版本清理。运行方式、证据与边界见[活动生命周期验证](../docs/testing/activity-lifecycle-2026-11-03.md)。只验证相关模块，不部署业务应用或访问业务库。

- 排行联动与空值：`ranking-filters.test.mjs`、`screens-manual-refresh.test.mjs` 覆盖上游重置、项目组收窄品种、缺失字段/空值、取消迟到请求、失败重试及最后成功条件刷新；`scripts/test-ranking-filters-browser.mjs` 用真实 React 和合成 HTTP 验证交互及 1920/1440/768/440 布局。`RankingFiltersIntegrationTest` 用隔离 MySQL 验证实际条件、适用且未下单的配置、分公司/经销商范围、新历史冻结与空格空值一致；`PageStatisticsControllerTest` 验证真实 MVC 参数和全局 NON_NULL 下仍输出 null 选项字段。运行与结果见[联动与空值验证](../docs/testing/ranking-cascade-2026-11-01.md)。

- 活动 HTTP 恢复（2026-11-01）：`ActivityInfoHttpServiceTest` 验证 304 跳过完整读取、短缓存、并发合并、时间派生状态、资源上限和独立副本缓存；`ActivityRoutesTest`/`ActivityInfoIntegrationTest` 验证真实 JSON/304/404 和共享数据库版本。`activity-info-http.test.mjs` 与合成浏览器验证检查周期、10 秒超时、隐藏/恢复、重试、活动隔离和无活动 SSE；公开资料脚本改读普通 HTTP。旧 SSE 保留兼容测试；旧 GET 删除记录为历史状态。详情见[本轮验证](../docs/testing/activity-info-http-2026-11-01.md)。

- 抽奖三种加权：`lottery-settings.test.mjs`验证指标与门槛联动、0门槛、名单复用和旧规则兼容；`LotteryWeightingTest`与`LotteryIntegrationTest`验证金额/箱数/吨数实际小计、零权重排除、真实开奖和审计对账。千人在线、200单/分钟的同流量对照见[加权验证记录](../docs/testing/lottery-weighting-2026-10-31.md)。测试不构建或部署业务镜像。

- H5 本机草稿与抽奖按页面加载：`h5-local-draft.test.mjs` 验证浏览器持久化、隔离、损坏/过期和存储失败；`h5-manual-refresh.test.mjs` 验证完整草稿生命周期及后台更新后的失效、提交成功清理/失败保留。`activity-info-http.test.mjs` 与 `lottery-board.test.mjs` 分别保证公共/H5 初始化不查询抽奖，以及抽奖页独立读取正常。浏览器验证无后台草稿请求、购物车保留和 HTTP 活动同步；本轮补充抽奖仅在页面打开且活动资料就绪后挂载。历史草稿验证见[记录](../docs/testing/h5-local-draft-2026-10-31.md)。

- 抽奖轮次排序：`npm run test:lottery-order`、`npm run typecheck:lottery-order` 及 `scripts/test-lottery-order-browser.mjs` 仅验证相关组件、排序保存和请求行为。后端 `LotteryOrderTest` 验证锁定边界、版本、位移写入及审计；`LotteryIntegrationTest#reordering*` 的4个真实MySQL用例及 `LotteryOrderHttpTest` 的12/100轮排序耗时、冲突/回滚验证已通过。HTTP专项沿用 `ORDER_SHOW_LOTTERY_TEST=order-show-lottery-test` 和33316固定隔离库，仅注册必要组件，管理员身份使用替身，不启动完整应用；禁止与同库测试并行。结果、复跑和性能边界见[本次记录](../docs/testing/lottery-round-order-2026-11-03.md)。不运行整体回归或部署镜像。

- 抽奖大屏图片与名单展示：运行 `node --test tests/lottery-board.test.mjs` 和 `node scripts/test-lottery-display-browser.mjs`。后者用真实组件与模拟 HTTP 检查 1920×1080、1366×768、390×844 下的 1/2/3/4/5/9/10/30/60 家名单，图片两倍尺寸及横图/竖图/方图/小图/无图、长名称换行、大名单滚动、滚动/揭晓/回看与展开顶部栏。截图和测量结果位于 `outputs/lottery-display/`；只启动本地测试页面，不构建或部署镜像。Playwright 可通过 `ORDER_SHOW_PLAYWRIGHT_MODULE` 指定，浏览器可通过 `ORDER_SHOW_BROWSER_PATH` 指定。

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
