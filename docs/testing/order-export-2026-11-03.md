# 异步订单导出：实现与定向验证

## 范围

仅修改 `order_show` 本地源码。未构建或部署业务镜像、未启动或重启业务服务、未更改业务数据库和 `.env`，未修改 `order_show-ack`。测试数据库和文件存储来自专用临时 Compose 项目 `order-show-export-test`。

旧同步 `/orders/export` 返回 410。新流程为创建任务 → 查询进度 → 下载 ZIP，沿用 Cookie、CSRF、HTTPS 和现有 HTTP 接口体系，不增加 SSE 或 WebSocket。原 UAT 500 的确切原因仍需对应后端日志确认，本次结果不代表已定位原报错。

## 权限与活动状态

- 创建、查询、取消、下载均仅限当前系统管理员 `SUPER_ADMIN`；部门管理员、具备订单模块权限的成员均不能使用。
- 创建、查询和下载要求活动为 `FINISHED`、`ARCHIVED`，或按现有活动规则已到整场结束时间。`CLOSED` 本身不满足要求。
- 重新开放会增加活动导出代次：排队任务失败，已完成文件过期，执行中任务收到取消信号。执行中的任务在真正停止前保持 `RUNNING`，继续阻止归档和删除。
- 原归档、删除流程要求先完成或取消导入、导出和待审核改单。正在删除的活动无法创建或下载文件；删除任务会清除关联导出记录及请求记录。
- 下载每次重新校验身份、活动状态、代次、任务完成状态及有效期。通用 `/public/files` 路径不能绕过任务权限读取导出结果。

## 输出内容

ZIP 中恰好四个 CSV，UTF-8 BOM、CRLF 行尾、标准引号转义，无 TXT：

| 文件 | 列数 | 统计范围 |
| --- | --- | --- |
| 订单汇总.csv | 15 | 当前状态、客户类型、关键词筛选 |
| 订单商品明细.csv | 17 | 同上，所有当前商品明细 |
| 有效商品汇总.csv | 9 | 固定已提交订单，仍使用客户类型、关键词 |
| 有效分公司汇总.csv | 6 | 同上 |

商品明细列为：订单编号、状态、来源、客户类型、大区、分公司、经销商、电话、订单版本、行号、物料代码、物料名称、项目组、订货箱数、金额、吨数、最后提交（北京时间）。删除的规格、箱规、阶梯价格和计价模式等字段仅针对这份明细；有效商品汇总保留原有规格、箱规字段。

金额使用十进制原值；时间按北京时间输出。CSV 无 Excel 列类型，双击打开可能丢失编号前导零或将长编号显示为科学计数。界面提示通过 Excel「从文本/CSV」导入，并将订单号、物料代码、电话等列设为文本。文本中的公式起始字符加单引号防护，数值不加单引号。数据顺序为订单 ID、商品行号升序。

## 任务与资源控制

- MySQL 持久化任务、筛选、行数、快照时间、失败原因、文件引用和有效期。相同请求键始终返回原任务；相同活动、筛选和代次的未完成任务共享执行，加入者的请求键也会记住结果。
- 单例执行许可保证全局一个有效执行者；默认最多 10 个未完成任务，队列满返回 429。90 秒许可、每 10 秒续期，进程中断后可接管，最多执行 3 次；过期执行者不能发布结果。普通生成错误保留失败记录，管理员可重新创建任务。
- 独立进程复用后端 JAR 的 `--export-worker` 模式，只注册导出需要的服务，无业务 HTTP 服务、业务定时任务及管理员初始化；明确排除 Flyway 自动迁移。
- 读取池 1 个连接；控制池另 1 个连接，供任务进度和续期使用。MySQL 重复读快照保证四份 CSV 一致；每批最多 2000 行商品明细及最多 200 条订单资料。明细按小批订单范围读取，避免跨表分页反复排序。
- 读取事务默认最多 120 秒、查询最多 30 秒；压缩、摘要、对象存储上传和下载均在读取事务之外。整个任务按 10 分钟期限停止续期并在检查点中止。
- CSV、ZIP 流式写磁盘，ZIP 压缩级别 1；四份 CSV 和 ZIP 共用临时字节预算，默认合计最多 1 GiB。开始前检查空闲磁盘，最终清理临时目录；进程中断遗留的目录在一小时后清理。不是内存 tmpfs。
- 上传从磁盘流式读取，下载由浏览器原生链接读取受保护接口，不使用整文件 `byte[]` 或浏览器 `blob()`。文件默认保留 24 小时；失败、过期和中断尝试的对象会重试清理。对象对应元数据在上传前登记，供活动删除清单发现。
- 空闲清理最多每分钟执行一次，过期任务、待清理文件及中断文件查询有专用索引；下载有效期仍逐请求精确校验。
- 页面仅在活动可导出、订单模块可见及浏览器可见时查询；有未完成任务每 5 秒查询，临时错误退避到 15 秒。完成后不持续轮询，只在到期或重新进入、刷新时查询。

进程 CPU、内存和连接限制可以降低影响，但数据库与对象存储仍共享。未进行 H5、排行和抽奖的混合压力测试，不能承诺线上其他业务延迟完全不变。

## 后续启用配置

此记录不执行部署。启用时需要 API 先应用 V052，前后端与 `export-worker` 配套更新；仅更新前端或 API 而不运行导出进程时，任务会持续排队。Compose 已添加独立服务并等待 API 健康，导出进程不执行迁移。

| 设置 | 默认值 |
| --- | --- |
| `ORDER_SHOW_EXPORT_QUEUE_LIMIT` | 10，API 配置 |
| `ORDER_SHOW_EXPORT_BATCH_SIZE` | 2000，最多 2000 |
| `ORDER_SHOW_EXPORT_READ_TIMEOUT_SECONDS` | 120，最多 300 |
| `ORDER_SHOW_EXPORT_MAX_TEMP_BYTES` | 1073741824，最多 10 GiB |
| `ORDER_SHOW_EXPORT_TEMP_DIR` | Java 临时目录下 order-exports；Compose 为 /tmp/order-exports |
| `ORDER_SHOW_EXPORT_RETENTION_HOURS` | 24，范围 1～168 |
| `ORDER_SHOW_EXPORT_TICK_MS` | 2000 |

Compose 默认 `cpus: 0.5`、`mem_limit: 512m`、Java `-Xmx256m`。工作进程沿用 API 的 DB、文件存储和电话查询密钥配置，但两个池各自固定最大 1 个连接；不继承 API 的大连接池设置。磁盘预算是每个导出任务的应用限制，需要部署环境同时监测宿主磁盘容量。ACK 多副本、独立调度和临时盘适配留待后续实施。

## 验证方式

后端测试仅在 `ORDER_SHOW_EXPORT_TEST=order-export-only` 时连接固定专用数据库 `127.0.0.1:33327/order_show_export_test`，会清理并迁移该专用库，不能指向业务库。文件存储使用独立 `33328` 端口。测试运行时为 JVM 指定可写临时目录。

```powershell
docker compose -f tests/order-export.compose.yml up -d --wait
$env:ORDER_SHOW_EXPORT_TEST='order-export-only'
mvn -f backend/pom.xml '-Dtest=CsvFileTest,OrderExportIntegrationTest,OrderQueryServiceTest,OrderSubmissionReadReuseTest,MemberPermissionServiceTest' '-DargLine=-Xmx256m' test
docker compose -f tests/order-export.compose.yml down
node --test tests/order-exports.test.mjs tests/activity-lifecycle.test.mjs tests/workspace-orders.test.mjs tests/order-review.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tests/order-export.tsconfig.json
node scripts/test-order-export-browser.mjs
```

浏览器脚本使用可用的 Playwright 包及 Chromium，可通过 `ORDER_SHOW_PLAYWRIGHT_MODULE`、`ORDER_SHOW_BROWSER_PATH` 指定。脚本启动临时 Vite 夹具并模拟导出接口，验证真实浏览器交互，不代表真实登录环境的端到端部署验收。

## 已验证结果

- 真实 MySQL 从 V001 迁移到 V052；队列上限、重复请求、共享任务键、并发创建、单执行许可、过期接管及旧许可拒绝发布。
- 四份文件、列顺序、BOM、逗号、引号、换行、公式防护、金额精度、北京时间和临时字节上限；实际并发修改后四份 CSV 仍使用同一快照。
- 4000 订单 × 50 商品共 200000 条明细，测试 JVM `-Xmx256m` 下成功生成并逐文件流式核对行数。优化后一次测量约 3.08 秒、ZIP 1204567 字节；数据为重复性较高的合成数据，临时 MySQL 数据盘使用 tmpfs，测试进程未施加 Compose 的 0.5 CPU 限额。不包含排队、上传和下载时间，不是生产耗时或压缩率承诺。
- 实际 MinIO 流式上传、受保护下载、24 小时有效期和到期清理；临时目录清理。模拟上传失败后会记录失败、隐藏内部错误、清理临时文件并允许创建新任务。
- 重新开放导致旧文件失效；取消运行中的任务前保留删除屏障；永久删除清理新增请求记录；真实路由拦截器校验 CSRF、系统管理员和删除标记，归档活动可创建任务；通用文件接口拒绝读取导出结果。
- 前端任务、权限、完成状态、重复点击、重试请求键、账号/活动切换、隐藏暂停及关闭清理；桌面 1440px 和手机 440px 浏览器交互、刷新恢复、下载地址和无横向溢出。
- 相关前端类型检查和 ESLint 通过。测试夹具与截图位于忽略目录 `outputs/order-export-browser`。
- 最终定向测试：后端 28 项、前端 30 项全部通过；OpenAPI YAML 及本地引用、Compose 配置检查通过。

没有运行全项目回归或业务服务部署，也没有确认原 UAT 500 的日志原因。
