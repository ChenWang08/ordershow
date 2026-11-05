# 历史活动配置复用：实现与定向验证

日期：2026-11-04。状态：待部署源码。本轮仅运行相关测试，没有构建、更新或启动本地业务应用，没有迁移业务数据库，也没有修改或部署 `E:\fengyi\order_show-ack`。

## 使用方式

在原“新建活动”抽屉填写新名称与新时间，确定部门后，按需勾选默认关闭的“复用历史活动配置”。来源仅显示同部门活动，包含已归档活动。部门管理员使用自己的部门，超级管理员选择部门，普通成员不能创建或复用。

选择来源时仅查询配置数量，商品、白名单、抽奖三项独立勾选；有效项默认选中，没有配置的项目禁用。切换部门清空来源与数量。创建过程显示进度，失败可继续原任务或放弃并清理隐藏草稿。

复制范围：

- 商品：当前有效版本中的商品及手动修改、阶梯价格、分公司和经销商限制、已关联图片、图片排序与主图设置。停用或删除的商品不复制。
- 白名单：当前有效客户与其联系人、手机号配置、所属大区及有效大区定义。客户主档仍遵循原有全局主档关系，活动客户行与版本独立。
- 抽奖：优先使用已发布规则，没有时使用最近保存的草稿（保存时间相同时按编号倒序）；复制全部轮次及顺序、门槛、权重、筛选、奖品图片。新规则与轮次都是草稿。
- 不复制现场到场名单、订单、审核、统计快照、抽奖候选、开奖尝试或中奖记录；使用到场人员作为候选的轮次显示重新导入本场名单提示。

复制读取的是提交时保存的有效配置，不包含来源页面尚未保存的编辑。新活动生成新编号，采用本次填写的名称和时间；商品/白名单使用新导入记录、发布版本与绑定，图片拥有新文件元数据和新存储对象。来源后续编辑或删除不影响新活动，复制结束后的目录、白名单、抽奖和订单沿用原读取路径，不再加载来源。

## 数据一致性与恢复

- V053 增加内部 `configuration_state`、复制任务、图片检查点及全局执行租约，已同步 `db/schema.sql`。
- 提交事务使用 READ COMMITTED，在短期来源活动共享锁内校验来源标记、读取受限配置快照并创建隐藏草稿；图片复制在事务外进行。共享锁与既有管理端写入排他锁协调，不阻塞持共享锁的正常 H5 订货流程。
- 同一创建人、同一请求编号及载荷返回原任务；请求编号相同但载荷变化被拒绝。前端发送前在 sessionStorage 保存原提交载荷（新活动信息、所选模块、来源标记、请求编号，不含客户明细），响应丢失后刷新可确认原创建结果。成功受理后只保存任务编号。浏览器禁用会话存储时仅保证当前页面内恢复。
- 先为图片预留新元数据与确定的存储键，原图及已有衍生图使用存储服务原生复制，逐文件保存检查点。最终新活动配置在单个目标事务内分批写入，完整提交才转为 READY；失败不会展示半成品。
- 失败重试继续原快照与已复制图片，不重新创建活动。中断租约可由另一实例接管，自动接管次数限制为3次。执行轮次预算为600秒，触限保留进度供手动重试。失败后的来源或文件若已被删除，重试可能无法完成，可放弃清理。
- 有排队或运行任务时，来源活动归档、永久删除及相关源文件物理删除受保护。成功或放弃后清除敏感快照与复制清单，保留简要任务凭证。放弃失败任务复用既有活动删除工作器清理隐藏草稿与预留对象。
- 修复了测试暴露的经销商限制写入顺序问题：先写限制范围，再写成员，避免依赖 Map 的不固定遍历顺序。工作器空闲与唤醒交接也增加代次检查，避免并发提交丢失唤醒。

## 性能范围与默认限制

| 项目 | 设计 |
| --- | --- |
| 执行并发 | 独立单线程执行器；所有副本共用一个数据库租约，同一时间最多一个复制任务执行 |
| 数据库连接 | 后台独立连接池每实例最多1个，最小空闲0；图片 I/O 期间不占连接；原业务连接池保持原配置 |
| 创建资源 | 短事务保存快照，默认总配置行数20000、序列化行内容累计8 MiB，队列最多10个；超限在创建目标前拒绝 |
| SQL | 创建查询5秒超时、创建事务15秒；后台查询10秒、最终事务30秒；每批最多200行，批量写入并启用 JDBC 批处理重写 |
| 图片 | MinIO/OSS 服务端原生复制，不由应用下载、转码或重复上传整张图片 |
| 统计 | 不读取源订单、审核或统计，不执行价格同步及订单重算；只对新活动记录一次目录版本与资料更新 |
| 空闲页面 | 未勾选复用不查询来源；选中来源才读数量，不预加载所有配置；仅面板打开、页面可见且任务未结束时约2秒查询任务 |
| 错误与终态 | 连续3次查询失败停止自动请求，提供手动查询；失败、完成、取消后停止；页面隐藏时暂停 |
| 后台空闲 | 启动、提交或查询进行中任务时唤醒；有排队/运行任务才继续调度，无空闲常驻任务轮询 |

限制参数见 `.env.example` 的 `ACTIVITY_COPY_MAX_ROWS`、`ACTIVITY_COPY_MAX_SNAPSHOT_BYTES`、`ACTIVITY_COPY_QUEUE_LIMIT`。行数包括客户、商品、轮次、子配置及文件元数据，不等同于商品数量。内存还包含 Java 对象开销，8 MiB 不代表堆占用上限。

复制期间仍会消耗 CPU、数据库和存储资源，并可能带来短暂争用。本轮证明了资源约束与数据独立性，没有进行整站并发容量或线上延迟验收，不承诺资源占用为零。

## 本轮实际验证

Docker 29.8.2 恢复可用后，使用独立项目 `order-show-activity-copy-test`：MySQL 8.4（仅测试库 `order_show_activity_copy_test`、33353端口）及 MinIO（仅测试桶 `configuration-copy-test`、39153端口），均为临时内存数据目录。Maven容器只运行测试，未构建业务镜像。测试没有连接现有业务数据库或操作业务容器。

| 验证 | 结果 |
| --- | --- |
| 前端定向测试 | 48项通过；其中配置复用12项，活动创建、部门权限、归档删除、抽屉行为及模块读取相关回归36项 |
| 后端定向测试 | 33项通过；其中真实MySQL/MinIO复制集成11项，其余存储、图片、文件权限及活动回归22项 |
| 真实数据库/图片 | 当前配置、独立原图及缩略图、去重图片、阶梯价和经销商限制、来源删除后可读、仅选部分模块、跨部门拒绝、成员拒绝、旧标记拒绝 |
| 批次和正常读取 | 453个有效商品跨多个200行批次复制完成，使用原 ProductCatalogReader 可读，后续来源绑定移除及双方独立编辑不串数据 |
| 故障与多副本 | 原生图片复制失败后隐藏且可续跑、请求去重、全局租约互斥、过期接管、源文件保护、放弃排队清理、超量拒绝 |
| 资源占用 | 图片复制被人为阻塞时，源活动可立即取得排他锁，复制池活动连接数为0；只验证锁与连接释放，不代表整站压测 |
| 抽奖来源 | 已发布优先；无已发布时选最近保存的草稿，归档来源可由同部门管理账号复用，到场始终为空 |
| 浏览器 | 1440px与440px实际组件/样式及模拟HTTP验证通过，含部门切换、缺项禁用、单次提交、断网后刷新确认、失败重试、终态停查、无横向溢出；另验证部门管理员自动限定本部门 |
| 静态检查 | 相关TypeScript及ESLint通过，OpenAPI YAML和本次引用检查通过 |
| OSS | SDK原生复制与缺失/无权限错误区分通过替身测试；真实OSS未验证 |

浏览器记录及已检查截图：`outputs/activity-copy-browser/`。测试日志：`outputs/activity-copy-front-tests.log`、`outputs/activity-copy-final-java-tests.log`、`outputs/activity-copy-browser-tests.log`。这些目录按现有规则忽略，不提交测试产生的数据。

复跑入口：

```powershell
node --test tests/activity-copy.test.mjs tests/admin-shell.test.mjs tests/activity-lifecycle.test.mjs tests/drawer-interactions.test.mjs
node node_modules/eslint/bin/eslint.js app/features/admin/useActivityCopy.ts app/features/admin/useAdminActivities.ts app/features/admin/NewActivityDrawer.tsx app/services/api/activity-copy.ts app/features/lottery/Lottery.tsx
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tests/activity-lifecycle.tsconfig.json
$env:ORDER_SHOW_BROWSER_PATH='C:\Users\Chen\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe'
node scripts/test-activity-copy-browser.mjs
docker compose -p order-show-activity-copy-test -f tests/activity-copy.compose.yml up -d --wait mysql minio
docker run --rm --name order-show-copy-database-tests --memory 768m --cpus 2 -e MAVEN_OPTS=-Xmx256m -e ORDER_SHOW_COPY_TEST=configuration-copy-only -v 'E:\fengyi\order_show:/workspace' -v order-show-m2:/root/.m2 -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml '-Dtest=ActivityCopyIntegrationTest,StorageCopyTest,StorageDeletionTest,ImageVariantsTest,ImageVariantServiceTest,ActivityServiceTest,PrivateFilePermissionTest' '-DargLine=-Xmx384m' test
docker compose -p order-show-activity-copy-test -f tests/activity-copy.compose.yml down
```

测试必须显式设置 `ORDER_SHOW_COPY_TEST=configuration-copy-only`，集成测试只访问代码中固定的测试库并断言库名，随后清空并执行V001至V053迁移。不要把测试连接改为业务库。Maven离线命令要求已准备 `order-show-m2` 测试依赖缓存；浏览器依赖也可通过 `ORDER_SHOW_PLAYWRIGHT_MODULE` 与 `ORDER_SHOW_BROWSER_PATH` 指定。

## 后续部署与ACK/OSS

本地启用需配套V053及对应前后端版本，依赖此前V050～V052；本轮没有做部署。默认 `STORAGE_PROVIDER=minio`，保留原 `S3_*` 配置兼容。OSS使用 `STORAGE_PROVIDER=oss`、`OSS_REGION` 和部署注入的 `STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`，应用不创建云桶。存储端读取、写入、导出流、图片复制和删除统一通过可配置适配层。

ACK项目当前只做兼容性对照，实际移植时应接入其现有OSS适配与密钥注入机制，保留本地MinIO路径，不覆盖ACK的云初始化和部署配置。ACK基线与本地源码有V049之后的迁移差异，部署前需核对V050～V053及相关源码依赖；云库由DBA执行有序SQL，不能依赖应用启动时Flyway自动改库。每个后端副本最多增加一个复制连接，要计入现有业务与导出连接预算；全局执行租约必须使用同一个业务数据库。

待真实环境验证：OSS内网原生复制、对象元数据与缩略图、RAM权限（源读取、目标写入及失败清理）、多副本恢复、DBA升级、代理超时及共享业务负载。本轮替身测试、独立数据库测试与浏览器模拟接口均不能替代这些云端验收。
