# 压力与性能测试

看板汇总改造可使用明确隔离的 `order-show-load-summary` 项目、8480端口和 `outputs/load-summary`。`capacity.mjs` 支持该项目，`summary-read.mjs <fixture-label> <并发数1..20> <秒数5..300>` 读取金额榜、吨数榜、看板、战报并保存延迟与错误。与持续提交叠加时，分别报告读取及提交指标；步骤和边界见 [汇总层验收](../../docs/testing/dashboard-summary-2026-10-29.md)。

`capacity.mjs submit-only <fixture-label> <并发数> <时长>` 仅用于隔离诊断：执行当前订单→增加数量提交→确认，省略草稿保存，仍校验版本/金额/数量/审计且不自动重试失败。其结果不能替代含草稿的 `sustain` 完整流程验收。报告记录汇总开关和挂载jar的SHA-256；压测引擎提前终止时保留服务日志及InnoDB快照，不把剩余只读时段当成持续混合负载。

草稿修复后的完整混合入口：设置上述summary项目/8480/结果目录后执行 `node tests/load/summary-mixed.mjs summary-main 90`，同启10个完整持续下单客户端和5个看板客户端；秒数可为5～300。两边实际起止时间仍以各自结果为准。先检查每轮结果，再决定是否重复或延长，不因脚本退出就默认通过。提交结果新增草稿死锁/重试/耗尽/恢复的计数增量，指标缺失记null而非0。

2026-10-29 白名单验证与大订单提交的代码优化、独立快照对照和实时回归见[本轮优化报告](../../docs/testing/h5-verification-submit-performance-2026-10-29.md)。`h5-screen-live.mjs` 只连接经过 `lib.mjs` 校验的隔离压测项目，使用当前前端刷新队列及真实 SSE，持续读取看板、金额/吨数排行和战报。调用形式为 `node tests/load/h5-screen-live.mjs <合成夹具标签> <观察毫秒数> <结果名称>`；写入负载必须先于观察窗口结束，脚本会在结束时核对四类页面总数、金额、数量、吨数与数据库一致。结果不包含浏览器绘制时间。

2026-10-29本轮完整结果见[最新综合/特渠混合容量报告](../../docs/testing/h5-capacity-2026-10-29.md)。请区分已验证客户首次下单、包含验证的完整首次流程、持续高频变更和纯手机号验证，避免沿用9月10商品/单的200用户结果解释当前180/41商品/单场景。

2026-10-29 最新源码的综合/特渠混合容量测试使用 `capacity.mjs`、`capacity-scenario.js` 和 `capacity-suite.mjs`。固定隔离项目 `order-show-load-20261029`、本地端口8380及 `outputs/load-20261029`；不连接业务库。每个新样本包含综合1072/特渠548名客户，同一活动内每单分别提交180/41种商品，数量均1。夹具包含合成图片元数据，不下载图片；统一箱价100，不代表真实阶梯价、分公司商品限制或线上数据库快照。`full`执行活动信息→手机号验证→商品→草稿→首次下单→确认，`consume`使用预置会话执行草稿→首次下单→确认，`verify`反复真实验证手机号并写入会话，`sustain`循环读取订单、仅增加全部商品数量后保存草稿/提交/确认。持续场景无思考时间，不能解释为普通在线人数。

新脚本使用 `includeHistory=false`，不自动重试失败请求；分别统计两类客户。验收：verify/商品/查单P95<500ms、活动信息P95<300ms、草稿/下单P95<1000ms、链失败率<1%、无5xx或数据错误；两类客户的单项也须通过。首次下单还要求1620名样本全部完成，防止漏发/提前停止。SQL核对提交与版本增量、验证与会话增量、审计完整/唯一、当前明细数量与金额。单档样本结束即停止，不将短波次称为持续容量；边界档另做持续复测。`journey`持续执行活动信息→验证→商品→当前订单→草稿→增加数量提交→确认，使用固定且不同的客户，所有数量只增不减；这与每名客户仅一次首次下单分开报告。每档使用新活动/客户，但同一数据库持续累积历史，属于本机限额下的容量观测，不是相同数据库快照的严格A/B。

```powershell
$env:LOAD_PROJECT='order-show-load-20261029'
$env:LOAD_RESULTS_ROOT='./outputs/load-20261029'
$env:LOAD_BACKEND_PORT='8380'
# 确认已从当前源码构建、启动专用后端及专属数据库后执行
node tests/load/capacity-suite.mjs full
node tests/load/capacity-suite.mjs verify
# 可选第三个参数为复跑后缀，避免覆盖之前样本，例如 verify r2
node tests/load/capacity-suite.mjs consume
# 持续复测先用新label生成1620样本，再运行sustain；不复用首次下单样本
node tests/load/capacity.mjs seed sustain-example 1620
node tests/load/capacity.mjs smoke sustain-example
node tests/load/capacity.mjs sustain sustain-example 10 5m
# 含每轮真实手机号验证和商品读取的持续链路：
node tests/load/capacity.mjs journey sustain-example 10 5m
```

上述套件保留失败档并停止继续升压，最多做两次区间细化；同名样本拒绝覆盖，复跑请使用新标签。输出夹具含测试会话，保持在忽略目录内。首次构建/挂载等基础设施失败不计作容量测量；完整原始报告、日志、监控与对账随各run保留。

2026-09-10虚拟线程、H5写入隔离和全新环境A/B见[高频优化报告](../../docs/testing/high-frequency-admission-report.md)。可用`LOAD_PROJECT`、`LOAD_BACKEND_PORT`、`LOAD_RESULTS_ROOT`和`LOAD_BACKEND_IMAGE`创建互不共享数据库卷/结果的隔离对照项目；项目名必须以`order-show-load`开头，结果必须位于`outputs/load-*`。`renew-sessions.mjs`只续期固定LOAD活动和既有虚构会话，不改订单/版本。

启动预热、同步批量审计和订单号碰撞修复的最新验证见[启动/审计优化报告](../../docs/testing/startup-audit-optimization-report.md)。`node tests/load/startup.mjs`仅重建隔离后端，记录就绪前503及预热前后数据计数；默认开启预热，`LOAD_H5_WARMUP_ENABLED=false`仅用于对照诊断。

千人首次下单样本耗尽时，先运行`node tests/load/extend-peak.mjs`追加所需虚构客户（不删除旧数据），再运行`prepare-peak.mjs`生成新样本。夹具备份含测试会话，仅保留于忽略的outputs/load目录。新压测按trace_id核对H5草稿/提交审计完整且无重复；公开手机号验证不在原有审计范围。

长稳可并行运行`node tests/load/soak-watch.mjs 3660`，约每30秒只读检查待发布事件年龄和看板API，异常即退出失败；这不等于连续SSE连接或浏览器渲染验证。SSE短探针必须在写负载前后运行，避免其额外写入污染版本计数。

最新H5高频诊断、批量写入和线程上限对照见[H5优化报告](../../docs/testing/h5-throughput-optimization-report.md)。当前后端HTTP线程默认上限40，数据库连接仍20；线程数不是在线人数。需要复现旧200线程配置时，设置`$env:LOAD_HTTP_MAX_THREADS='200'`后重建隔离backend容器，测试完恢复默认，不改变业务Compose。

千人场景和60分钟长稳见[执行说明](../../docs/testing/thousand-peak-soak-plan.md)及[本轮结果](../../docs/testing/thousand-peak-soak-report.md)。运行入口为`node tests/load/thousand-soak.mjs`；首次下单样本必须未下过单，重跑前按说明准备隔离夹具。

仅管理 `order-show-load` 项目，后端入口固定为 `127.0.0.1:8280/api/v1`。
需要 Docker、Node.js 22.13+。k6 使用固定镜像 `grafana/k6:1.6.0`。

```powershell
docker compose -p order-show-load -f docker-compose.load.yml up -d --build backend
# 等健康检查 UP 后再继续
Invoke-RestMethod http://127.0.0.1:8280/api/v1/actuator/health
docker compose -p order-show-load -f docker-compose.load.yml pull k6
node tests/load/seed.mjs
node tests/load/verify.mjs
node tests/load/run.mjs mixed 5 2m
node tests/load/history.mjs 1000
node tests/load/run.mjs mixed 10 3m
```

`seed.mjs` 在事务内生成两场活动、600 个商品、2550 个虚构客户及独立 H5 会话；重复执行会拒绝覆盖。
使用直接 SQL 构造目录/会话，不代表导入流程经过性能验收。首次登录 API 在正确性测试中另行验证。
`history.mjs` 使用真实 API 创建订单，最多 2000 个客户，准备时间不计入负载指标。
夹具、会话和报告写入 Git 忽略的 `outputs/load/`；不要上传 fixture.json。

场景：`read` 商品；`write` 当前订单查询及提交；`mixed` 商品、当前订单、草稿、提交；
`multi` 两活动混合流程（最多100用户）；`dashboard` 看板；`verify` 身份验证。
每轮写入改变数量，验证金额、客户和版本；重复修改会积累真实历史版本，此数据增长会影响后续测量。
每个用户默认停顿1秒，可用 THINK 修改。不要把用户数解释为每秒请求数。

优化版本的H5前端使用轻量订单响应。设置`$env:LIGHTWEIGHT='1'`可对当前订单查询/提交附加`includeHistory=false`，随后删除环境变量；默认不设置仍测试兼容的完整历史响应，便于与原基线比较。
`node tests/load/optimization-checks.mjs`覆盖轻量响应一致性、并发调价与截止竞争；仅使用LOAD夹具，会恢复第二活动的测试状态及首商品价格。

真实数据库锁测试需要已生成LOAD夹具，并显式启用：
```powershell
docker run --rm --network order-show-load_default -e ORDER_SHOW_LOAD=order-show-load -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -f backend/pom.xml test
```
普通Maven运行会跳过该隔离锁测试。测试只连接固定的order_show_load数据库；关闭状态测试临时修改LOAD-2并在finally恢复。

`first`对每个用户只执行一笔首次订单，通过OFFSET选取未使用客户。例如准备1000笔历史订单后，
设置`$env:OFFSET='1000'`再执行`node tests/load/run.mjs first 5 2m`，随后删除该环境变量。
首次订单场景中已有订单会使数据断言失败；不要重复复用相同OFFSET。
`followups.mjs`是本轮初测专用的顺序诊断编排，使用固定未占用客户区间；完整复跑需新建夹具。

```powershell
.\scripts\run-load-tests.ps1 -Mode read -Vus 50 -Duration 3m
$env:RATE='20' # 每秒启动20次业务迭代；mixed每次4个HTTP请求
node tests/load/run.mjs mixed 50 5m
Remove-Item Env:RATE
$env:ITEMS='50'
node tests/load/run.mjs write 10 3m
Remove-Item Env:ITEMS
node tests/load/sse.mjs 50
node tests/load/admin.mjs
node tests/load/verify.mjs
```

恢复专项（先停止负载，仅重启专属服务）：
```powershell
node tests/load/recovery.mjs redis
node tests/load/recovery.mjs backend
```
检查重启后已提交订单的幂等重放，不能替代事务中断或抽奖锁失效演练。

SSE测试测量请求开始到匹配订单的invalidate事件到达，不包括浏览器重新查询和渲染；完整页面3秒验收仍需浏览器测试。
admin测试包含列表/搜索/筛选、Excel响应和商品100→101→100调价，检查历史版本不变。
admin调价应在没有其他写负载时执行，确保金额差额断言有效；测试失败后应检查价格是否已恢复。

每次 run 输出 k6 JSON、逐接口延迟、JVM/Hikari（含连接占用时长）采样、容器资源、后端镜像/限额/线程环境参数和数据库SQL摘要前后快照。SQL摘要为累计计数，诊断时比较前后差值；数据库重启会清空摘要，不能跨重启直接相减。
读P95≤500ms、写P95≤1500ms、P99≤3000ms、正常请求错误率<1%、数据错误为0。
错误率超标30秒后中止，数据错误5秒后中止；延迟超标使退出码非0，须人工检查后才继续升压。
固定到达率模式要求 dropped_iterations 为0。
异常409不能从正常负载中排除；正确性脚本独立验证预期409。

资源：后端2CPU/1280MiB（堆768MiB），MySQL1.5CPU/1GiB，Redis128MiB，MinIO256MiB，k6 2CPU/1GiB。
MySQL与MinIO使用压测专属磁盘卷。宿主机与本机业务共享，结果只能作为本机限额配置基线。
监控HTTP端点只在本地使用；未添加生产监控配置。

停止并保留数据：
```powershell
docker compose -p order-show-load -f docker-compose.load.yml stop
```

确需重新生成夹具时，在确认报告已保存后，只清理上述固定项目：
```powershell
docker compose -p order-show-load -f docker-compose.load.yml down --volumes
```
此操作永久删除压测数据库与文件卷；输出报告保留。禁止替换成业务Compose文件。

参考：[k6阈值](https://grafana.com/docs/k6/latest/using-k6/thresholds/)、
[优雅停止](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/graceful-stop/)。
