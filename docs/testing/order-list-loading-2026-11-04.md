# 后台订单与变更审核加载、统计及分页

## 实现范围

- 订单与审核列表统一每页50条，保留上一页/下一页，新增页码选择，可直达末页；不预读全部页面。搜索、筛选和排序由后台执行，回到第一页，取消订单前端的重复筛选。
- 订单列表首次进入、返回、手动刷新和修改后读取当前页及独立汇总；普通翻页、搜索和筛选只读取目标页。汇总四种订单数量使用一次条件聚合，待审核数量独立索引计数，响应仅含5个数量。
- 订单当前页通过V034已有的待审核唯一索引取得 `pendingChangeRequestId`，不增加逐行查询。审核列表不再请求全活动待审核编号清单；旧接口保留兼容旧客户端。
- 审核进入、返回及手动刷新时更新当前页及汇总；通过/驳回完成后只刷新一次当前页和汇总；订单新增/修改/作废同样各一次。末页减少时再读取一次有效页。关闭详情、取消编辑不读取列表或汇总。
- 停留页面无操作时不自动刷新，不增加轮询。列表与汇总独立处理失败，首次数量未知显示“—”，有旧值时保留并提示未更新；数量可独立重试。两次请求为独立快照，并发写入可能短暂使列表总数与数量卡片不同。
- 复用原后台权限与活动访问拦截，活动变更重建工作台，外层仍按账号和权限隔离；保留请求取消、迟到响应保护、审核备注、幂等及版本校验行为。
- H5及商品/白名单/到场列表行为未修改；无新增数据库迁移，前后端须配套更新，尚未部署。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 相关前端行为测试 | 58/58通过，无跳过 |
| 后端订单查询/HTTP/权限及订单回归 | 43/43通过，无跳过 |
| 独立MySQL 8.4查询验证 | 3/3通过，无跳过 |
| 浏览器合成HTTP测试 | 1440px、440px均通过 |
| 相关TypeScript及修改文件ESLint | 通过，无错误或警告 |
| 前端生产构建 | 通过 |
| Git差异空白检查 | 通过 |

前端测试文件：`order-loading.test.mjs`、`workspace-orders.test.mjs`、`order-review.test.mjs`、`admin-manual-refresh.test.mjs`、`order-exports.test.mjs`、`activity-lifecycle.test.mjs`。覆盖直接跳页、固定50条、关键词/状态/客户类型/审核类型/排序、无空闲轮询、手动刷新在途合并、数量首次失败与旧值保留、列表失败重试、最后一页减少、活动切换、旧响应及卸载保护，以及订单编辑和审核版本冲突提示。

浏览器使用真实 `OrderManagement` 及子组件、纯合成HTTP响应，在React StrictMode中核对：首次订单页1次列表+1次汇总，普通翻页仅1次列表；审核通过/驳回及订单新增/调整/作废后，各增加1次当前页读取及1次汇总；关闭/取消0次列表与汇总；列表/汇总分别失败时另一部分正常展示，数量可独立重试；搜索大小写差异不再被前端过滤。断言无全量待审核编号请求、无未预期接口、无页面脚本错误。截图位于忽略目录 `outputs/order-loading/`。

后端43项使用真实业务代码、受控JDBC或业务依赖，包含 `OrderQueryServiceTest`、`OrderSummaryHttpTest`、`MemberPermissionServiceTest`、`OrderSubmissionReadReuseTest`、`OrderSubmitWritePathTest`、`OrderServicePricingTest`、`OrderAfterSubmissionTest`、`OrderHistoryBatchTest`、`H5OrderReadTest`。新增汇总检查活动参数、零记录、聚合与索引计数，HTTP检查精确路由绑定，权限检查ORDER资格，当前页检查待审核关联及空值；所有后端源码及测试源码均重新编译。

MySQL验证通过专用 `order-query-test` Compose项目创建无主机端口、内部网络、内存数据目录的临时测试库。使用与查询相关的生产字段类型和待审核生成列/唯一索引的最小表结构，构造125笔订单、另一个活动和空活动；实际执行新汇总与分页SQL，检查各状态与待审核数量、活动隔离、最后一页25条、历史已审核记录不造成重复、空申请编号、筛选与超出末页。没有执行全业务迁移或真实审核写入验收；测试容器和网络已移除，未访问业务库。

类型检查采用专用 `tests/order-loading.tsconfig.json`，覆盖订单组件与API及其传递依赖。全仓默认配置会扫描历史工作目录，本轮不以全仓类型检查或无关全量测试作为结果。

## 请求与查询收益

| 操作 | 修改前 | 修改后 |
| --- | --- | --- |
| 订单进入/手动刷新 | 5个列表请求 | 1个列表+1个汇总 |
| 订单普通翻页/筛选 | 5个列表请求 | 1个目标页请求 |
| 审核普通翻页 | 当前页+全活动待审核编号 | 当前页 |

以上不含身份/权限、详情、编辑资源与导出等独立请求。原订单5个请求合计执行10次订单查询；新普通翻页为总数与当页共2次查询，汇总读取为1次订单条件聚合及1次待审核计数。跳页仍使用原LIMIT/OFFSET与总数查询，数据库工作量不等同于只读50行。本次验证请求数量及正确性，没有进行共享负载、UAT或线上延迟/吞吐压测，不承诺整套系统提速比例。

## 复跑

~~~powershell
node --test tests/order-loading.test.mjs tests/workspace-orders.test.mjs tests/order-review.test.mjs tests/admin-manual-refresh.test.mjs tests/order-exports.test.mjs tests/activity-lifecycle.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tests/order-loading.tsconfig.json
node node_modules/eslint/bin/eslint.js app/components/orders/OrderManagement.tsx app/components/orders/OrderFilterBar.tsx app/components/orders/OrderListTable.tsx app/components/orders/OrderChangeRequestPanel.tsx app/components/orders/OrderPagination.tsx app/components/orders/useOrderList.ts app/components/orders/useOrderSummary.ts app/components/orders/useOrderChangeRequests.ts app/components/orders/order-domain.ts app/services/api/orders.ts app/services/api/types.ts
node node_modules/vinext/dist/cli.js build
node scripts/test-order-loading-browser.mjs

docker run --rm --memory 1536m --cpus 2 -v order-show-m2:/root/.m2 -v "E:\fengyi\order_show:/workspace" -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml '-DargLine=-Xmx512m' '-Dtest=OrderQueryServiceTest,OrderSummaryHttpTest,MemberPermissionServiceTest,OrderSubmissionReadReuseTest,OrderSubmitWritePathTest,OrderServicePricingTest,OrderAfterSubmissionTest,OrderHistoryBatchTest,H5OrderReadTest' test
docker compose -p order-query-test -f tests/order-query.compose.yml up --abort-on-container-exit --exit-code-from test
docker compose -p order-query-test -f tests/order-query.compose.yml down
~~~

浏览器脚本支持 `ORDER_SHOW_PLAYWRIGHT_MODULE` 与 `ORDER_SHOW_BROWSER_EXECUTABLE` 指定本机浏览器测试工具路径。原始日志保存在忽略目录 `outputs/order-loading-*.log`。本次仅构建前端产物及运行隔离测试，未构建业务镜像、未启动完整业务服务、未部署或推送；合成前端和浏览器均已退出。
