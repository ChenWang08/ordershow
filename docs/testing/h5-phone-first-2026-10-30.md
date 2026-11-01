# 手机号优先登录：本地源码验证（2026-10-30）

## 范围与状态

基线为本地 main `9b8df44`。只修改 `E:\fengyi\order_show` 源码、测试和接口文档；按用户要求纳入本次本地 Git 提交，未推送、未同步 ACK、未构建发布镜像、未部署或重启业务服务，未读取或修改业务数据库。本轮开始时 `docker ps` 没有运行容器，因此没有为测试启动原业务服务。

用户只输入手机号。唯一有效身份直接创建会话；综合与特渠同号返回类型选择，弹窗选项仅“综合 / 特渠”，无姓名、大区或分公司。确认后重新查当前身份，登录页不再限制大区。订货页使用服务端身份展示类型、大区、分公司和经销商名称。订单提交、商品定价和权限实现未改。

后端新 `H5PhoneVerificationService` 在事务外完成参数整理和手机号哈希；事务内一次查询活动/部门/当前名单/手机号，成功再调用 `AuthService.createH5Session`。不再执行旧名单级大区子查询。类型明确的旧请求仍可登录，旧 `regionCode` 接受但不参与选择。未指定类型的含义从旧 ALL 默认改为自动识别。待选择结果无会话插入、无 CSRF 和客户详情，不设置新登录 Cookie；已有 Cookie 不在查询阶段撤销。成功 Cookie 仅在事务提交后写入。

活动状态/开始时间/结束时间、部门启用、客户启用、发布版本检查保留。同类型多重身份以及 ALL 与其他类型混合的自动识别结果拒绝，不任取首条。缺失/空版本绑定暂保留旧跨版本查找，多个同类型匹配拒绝。该兼容分支不是建议跳过新活动名单发布。

## 观测

- `order_show.h5.verify.total`：服务入口至事务结束，结果标签 login/selection/rejected/error，不含网关和响应网络传输。
- `order_show.h5.verify.stage`：transaction_begin（获取连接及事务初始化）、identity_query、session_create（令牌和会话插入）、transaction_finish（提交或回滚及回调）。transaction_finish 不是纯数据库 commit 时间。
- 超过 500ms 输出 `h5.verify.slow`，含 trace 和上述分段毫秒数。不记录手机号、手机号哈希、Cookie 或令牌，不使用客户信息作指标标签。
- 数据源 Hikari 自带连接池指标可辅助观察；本轮未改变管理端点暴露和云端配置。

## 功能验证

- 前端 283 项自动测试通过；新增手机号登录、唯一 GENERAL/SPECIAL/ALL 身份、双身份只显示类型、不提前加载商品、取消/改号清除候选、确认失败不进入订货、快速点击串行化等覆盖。订单路由和客户切换草稿保护继续回归。
- 类型检查、ESLint 和前端构建通过。构建存在原有大体积 chunk 提示，不影响通过；构建产物不等于部署。
- 后端执行 252 项：198 通过、54 因专用环境未开启而跳过、0 失败。包括 6 项新服务单元测试、8 项真实 MySQL 功能/事务/并发测试和 1 项显式启用的性能对照。历史 surefire 文件可能仍在 target；以本轮执行汇总为准。
- 替换旧大区选择规则的两个集成测试，新测试覆盖唯一/多身份、历史/停用/跨活动隔离、同版本修改、发布切换、活动与部门状态、缺失/空绑定重复拒绝、另一个无缓存 AuthService 实例读取和撤销感知、事务回滚无 Cookie、30 并发会话完整性。旧查询冻结在 `LegacyH5VerificationBaseline`，仅用于性能对照，不进入正式代码。
- MockMvc 使用实际 controller/service/数据库验证请求与响应；不是完整 Spring Security HTTP E2E。浏览器使用真实 React、实际样式和 API 客户端，但 HTTP 全部由合成响应拦截，不连接业务服务。
- Edge 无界面浏览器检查通过：390×844 手机和 1440×900 桌面，输入、唯一登录、类型弹窗、焦点和 Escape 取消、确认失败及重试、身份展示。截图在忽略目录 `outputs/h5-phone-entry/`。

## 本地性能对照

独立 Compose `order-show-phone-test`，数据库 `order_show_phone_test`，无宿主机端口。MySQL 8.4 限 2 CPU/1GiB；测试进程限 2 CPU/2GiB，Hikari 最大 10。5000 个合成客户，正常对照综合/特渠各半。表保留手机号、令牌索引和会话外键，但不是业务全库复制。

旧基线复用 `9b8df44` 的原验证 SQL；两版用相同会话写入和事务管理器。先各预热 100 次，再按旧/新、新/旧交替各执行 600 次，30 个工作线程。每组开始清空合成会话表，组内逐步增加到 600 条，会话增量和唯一令牌均核对。统计的是工作线程开始执行到服务事务完成，不包括任务提交队列、网关、网络和页面渲染。

最终一轮：

| 场景 | P50 ms | P95 ms | P99 ms |
| --- | ---: | ---: | ---: |
| 旧查询，30 并发，第 1 组 | 12.71 | 159.46 | 216.54 |
| 新查询，无新增索引，第 1 组 | 24.23 | 76.19 | 89.92 |
| 新查询，无新增索引，第 2 组 | 23.83 | 73.82 | 91.18 |
| 旧查询，30 并发，第 2 组 | 7.55 | 136.29 | 291.72 |
| 新查询，1 并发 | 3.97 | 5.10 | 7.03 |
| 新查询，10 并发 | 7.36 | 22.57 | 26.78 |
| 新查询，60 并发 | 45.83 | 151.65 | 190.67 |

初轮旧 30 并发 P95 为 116.04/154.38ms，新版为 78.55/70.91ms。新版长尾较好，但 P50 更高，整体吞吐存在交叉，不能声称所有指标都改善。样本短、同宿主机资源和预热波动，未在本地复现报告中的 5～18 秒，不代表定位了 ACK 根因。

## 索引实验结论

仅在合成库临时增加非唯一 `(activity_id,phone_lookup_hash,data_version_id)` 索引；保留原跨类型同号唯一约束。这个顺序兼顾缺失版本绑定兼容路径。简单精确查询 EXPLAIN ANALYZE 显示覆盖索引查到 1 行，但该计划不等同于完整身份关联查询计划。

初轮新查询加索引 P95 69.66ms、未加 70.91～78.55ms；第二轮加索引 52.76ms、未加 73.82～76.19ms。由于索引样本均在后半程、未控制交替删除/重建和写入成本，收益尚不足以作正式数据库迁移决策。**本轮不新增迁移，不改业务索引**；实验索引在测试 finally 中删除。后续有完整关联执行计划、长时间 A/B 和导入写入成本证据后再决定。

## 复现

```powershell
pnpm typecheck
pnpm lint
pnpm build
node --test tests/*.test.mjs

docker compose -p order-show-phone-test -f tests/phone-verification.compose.yml run --rm phone-tests
# 显式开启合成性能实验：
docker compose -p order-show-phone-test -f tests/phone-verification.compose.yml run --rm -e ORDER_SHOW_PHONE_BENCHMARK=true phone-tests

# 使用本机可用 Playwright，必要时指定已有浏览器路径：
# $env:ORDER_SHOW_PLAYWRIGHT_MODULE='file:///.../playwright/index.mjs'
# $env:ORDER_SHOW_BROWSER_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/test-h5-phone-entry-browser.mjs
```

测试依赖已缓存 Maven 镜像及 `order-show-m2` 卷，默认离线运行；数据库是本轮新建的专用测试卷。复跑会重建该合成库内的 fixture 表，不接受业务数据库地址。浏览器临时 Vite 测试服务在脚本结束后关闭。

收尾已停止本轮 `order-show-phone-test-phone-mysql-1`，保留合成测试卷以便后续复跑；测试进程均退出，`docker ps` 再次为空，与本轮开始一致。没有启动、停止或重启原业务容器。

## 未验收及后续统一工作

未进行业务存量手机号只读审计、完整新后端 HTTP 链路压测、300 浏览＋30 下单混合场景、长时稳定性、生产数据库执行计划、实际双 Pod 或 ACK 验收。未改变业务连接池、网关或缓存策略。54 个跳过测试不算通过。

按用户要求，后续其他功能完成后再统一进行上述联调/容量验收和部署。不能用本记录宣称 ACK 的手机号或浏览卡顿已解决。未来发布先后端后前端；仅回退前端仍可使用明确类型旧请求，回退后端前必须同时恢复匹配的旧前端，避免新前端手机号自动识别请求被旧后端当成 ALL。
