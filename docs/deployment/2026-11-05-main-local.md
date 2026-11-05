# 本地 Docker 完整更新（2026-11-05）

## 部署结果与版本

北京时间 **2026-11-05 01:08:48**，本机 `E:\fengyi\order_show` 的 Docker Compose 项目 `order-show` 完成更新。管理后台为 [http://localhost:3000/admin](http://localhost:3000/admin)，H5 和展示页沿用原活动地址。前端通过同一入口 `/api/v1` 调用接口，后端原 8080 端口保留。

运行源码来自干净 Git 导出的 **`27bf427d2765108809822ae127406e304d469b16`**。上轮图片与统一入口版本对应 `8f73326`；本次包含 `3cb9daee96d8a3537168e8267d22f051eda69420` 及之后 16 条提交，共 17 条此前未部署的提交。`3cb9dae` 本身也在本次范围内。

| 服务 | 固定镜像 | 实际镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:local-27bf427-20261105` | `sha256:da8d5e9012965e4730b51e9da1a36e73f5544008f5aca8bea73fa9cdd0d46696` |
| 后端 | `order-show-backend:local-27bf427-20261105` | `sha256:cc7ff3d483c159e20cae91b5b3e9c79032f6649e7f403d9e50b62cf878319cf7` |
| 独立导出进程 | 同后端镜像，启动参数 `--export-worker` | 同后端 |
| 统一入口 | 沿用 `nginx:stable-alpine` | `sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949` |

业务验收后，前后端 `latest` 已同步至上述镜像。数据库 **V049 → V053**。MySQL、Redis、MinIO 原容器 ID 和数据挂载不变，实际 `.env` 文件哈希不变；未修改 ACK 项目或云端资源。部署记录及配套修正随后保存至本地 Git，源码及镜像未推送。

本轮功能包括活动配置复用、归档/取消归档和异步永久删除、异步订单 CSV ZIP 导出、抽奖轮次安全排序与大屏布局、后台订单/审核分页及汇总、列表局部更新与导入防重复点击、H5 数量控件和排行布局修正。

## 本地运行配置

固定镜像覆盖文件为 `outputs/local-release-20261105/release.compose.json`。本次使用根目录 Compose 配置配合该文件运行；需要按相同版本重建应用服务时，命令为：

```powershell
docker compose -f docker-compose.yml -f outputs/local-release-20261105/release.compose.json up -d --no-deps --no-build --pull never backend export-worker frontend gateway
```

此命令以数据服务已运行、数据库已完成升级为前提，不是备份或恢复命令。不要删除数据卷。固定覆盖文件、测试输出与备份保留在本机忽略目录中。

导出进程配置 `SPRING_MAIN_KEEP_ALIVE: "true"`，保证非 Web、虚拟线程模式下空闲时持续运行；否则进程可能在启动后约一分钟退出。该修正已写入 `docker-compose.yml`，并在最终隔离镜像及业务部署中验证。资源保持 0.5 CPU、512 MB 内存、256 MB Java 堆上限。部署后复查，导出进程持续运行超过三分钟且重启次数为 0；后端及数据服务健康，前端和入口运行正常，业务后端与导出进程启动后的 ERROR 日志均为 0。

镜像使用上述提交的业务源码。本轮另修改了测试夹具和过时断言、类型检查目录排除及 Compose 运行配置；这些修改与本记录一起保存至本地 Git，没有改变运行镜像中的业务源码。

### 默认启动配置补充修正

11 月 5 日早间，直接运行 `docker compose up -d` 时，默认配置仍给导出服务保留独立 `build`，因此生成了 `order-show-export-worker:latest`。终端中的 `Image ... Built` 和 `Container ... Started` 分别表示构建镜像与启动容器，不是新增两个服务。

现已在根目录 Compose 中让后端和导出服务共用 `order-show-backend:latest`，仅后端保留构建定义；二者设置 `pull_policy: never`，使用本地镜像。首次初始化或更新源码使用 `docker compose up -d --build`，日常启动使用 `docker compose up -d`。固定版本覆盖文件继续可用，`latest` 当前与本次固定版本的镜像 ID 相同。

已实际应用配置，并再次执行不带额外参数的 `docker compose up -d`：没有构建、拉取或重建容器。构建计划仅含 backend/frontend，导出服务不再是独立构建目标。前后端镜像 ID 与本次已测试版本一致，后端和导出容器使用同一镜像；原 MySQL/Redis/MinIO 容器及挂载、实际 `.env` 保持一致，后台返回 200、后端健康为 UP。

确认已无容器引用后，仅删除了本次多余的 `order-show-export-worker:latest` 镜像；导出容器继续运行，旧版本备份镜像保留。检查记录为 `outputs/local-release-20261105/compose-image-reuse.json`、`compose-reuse-apply.log` 和 `compose-reuse-repeat.log`。

## 备份、恢复与回退演练

更新前停止业务服务，完成数据库、MinIO、Redis 数据卷冷备份，并保存 SQL、配置、容器/挂载及固定镜像信息。目录：

`E:\fengyi\order_show\backups\local-release-20261105`

主要文件：

| 文件 | 内容 |
| --- | --- |
| `order-show_order-show-mysql.tar.gz` | MySQL 冷备份，38,725,558 字节 |
| `order-show_order-show-minio.tar.gz` | MinIO 冷备份，674,571,714 字节 |
| `order-show_order-show-redis.tar.gz` | Redis 冷备份，700 字节 |
| `database-v049.sql` | 升级前 SQL |
| `database-before.json`、`schema-before.json` | 49 张原表的数量、原列内容哈希及结构 |
| `backup-manifest.json` | 备份文件哈希 |

实际配置和容器快照含私密信息，仅保存在本机备份目录，不纳入仓库或公开报告。

已把 MySQL 和 MinIO 冷备份实际恢复到独立测试数据卷；**49 张原表**的数量和内容哈希完全一致，MinIO **4648 个物理对象文件**逐文件哈希一致。随后在副本上用最终后端升级至 V053，升级成功。

在升级后的副本上配套运行上次前后端镜像，22 项真实 HTTP 检查通过；再切回新镜像，同样 22 项通过。旧镜像保留为：

- 前端 `order-show-frontend:local-same-origin-20261102.1`
- 后端 `order-show-backend:local-images-20261102.1`

该回退演练发生在新功能写入前，不能据此认定旧镜像能处理活动复制、归档或删除后的所有新状态。需要实际回退时，先停止并发写入、保存当时新增数据，再选择配套应用回退或数据库/对象存储恢复；全量恢复到本次备份会丢失备份之后的写入，不能直接覆盖。原始备份保留，独立恢复环境已停止，恢复副本数据卷保留。

## 测试范围与结果

写入类测试均使用独立数据库、对象存储与合成活动；业务环境只进行只读验收，没有为测试重置真实密码、创建真实订单或修改业务配置。

| 验证 | 最终结果 |
| --- | --- |
| 前端全量自动化 | 469 / 469 通过 |
| 根目录及维护源码 TypeScript | 通过 |
| 维护源码 ESLint | 通过 |
| 后端测试报告合并去重 | 358 通过、99 按环境条件跳过、0 失败，共 457 项 |
| 生命周期、启动与存储专项 | 18 通过 |
| 配置复制，真实 MySQL/MinIO | 11 通过 |
| 异步导出，真实 MySQL/MinIO | 10 通过 |
| 抽奖集成及 HTTP 专项 | 16 通过 |
| 最终镜像真实 HTTP 端到端 | 10 通过 |
| 副本旧/新镜像检查 | 各 22 项通过 |
| 真实浏览器和宽窄屏夹具 | 通过，见下述范围 |
| 部署后业务只读验收 | 11 个活动、48 项检查通过 |

专项和端到端条目包含在后端报告合并统计中，不能再次相加。99 项跳过属于其余受环境条件控制的集成/负载用例；上表本轮专门启用的四组集成及 HTTP 端到端用例均实际执行，没有跳过。不是所有历史容量用例都已重跑。

真实 HTTP 端到端覆盖登录/改密/CSRF、导入、手机号验证与商品读取、订单提交和幂等、修改/撤回/审核、变价、抽奖并发、统计、结束/重开，以及异步任务生成和四份 CSV ZIP 下载。额外真实接口覆盖独立草稿复制、请求去重、不复制订单、永久删除到 COMPLETED、归档和取消归档；抽奖配置复制由专项集成测试覆盖。

真实浏览器连接最终镜像和合成 API，完成后台登录和六个模块读取、H5 验证和下单、看板/排行/战报/抽奖访问；排行实际点击确认并收到 200，无页面或接口失败。浏览器夹具另覆盖生命周期（1440/440/320）、复制、导出、排行筛选、抽奖大屏 27 种情形、订单分页、列表加载、H5 阶梯价数量控件和抽奖排序等宽窄屏情形。夹具检查属于合成接口交互验证，真实业务浏览器检查没有登录真实账号或提交业务订单。

### 导出与下单混合验证

最终镜像在导出进程 0.5 CPU / 512 MB / Xmx256m 限额下，处理 **4000 笔订单 × 50 种商品，共 200,000 条明细**。生成、轮询、上传、下载及 ZIP 校验合计 **13,466 ms**，ZIP 为 1,336,696 字节，四份 CSV 数据行数分别为 4000、200000、50、1。

同时运行的合成客户端结果：

| 操作 | 成功数 | P95 | 最大耗时 |
| --- | ---: | ---: | ---: |
| H5 写入 | 55 / 55，均 200 | 42.67 ms | 100.86 ms |
| 排行读取 | 112 / 112，均 200 | 12.58 ms | 20.30 ms |

这是本机有界合成写入/读取与导出的共存检查，不代表千人浏览器、持续高峰或云端容量验收。

### 测试过程中处理的问题

首次广泛类型扫描包含 `work`、`outputs` 等历史副本，叠加并发测试数据库使本机 Docker 一度无响应。已恢复 Docker，停止本轮过量检查进程，在 `tsconfig.json` 排除生成目录和副本，并将后端专项改为逐组执行。Windows 下依赖临时 HTTP 服务的测试改在隔离 Linux Node 容器内完整执行。已修正测试中已删除导出类、旧同步导出接口、开奖版本和手机号入口等过时断言，以及后台动作组件夹具。最终测试结果以上表及最终日志为准，早期中断、失败报告不计入成功结果。

## 部署后的原数据核对

| 数据 | 数量 |
| --- | ---: |
| 活动（含全部状态） | 12 |
| 订单 | 463 |
| 当前订单明细 | 2760 |
| 历史订单版本 | 517 |
| 历史版本明细 | 2893 |
| 订单汇总 | 463 |
| 活动商品 | 4551 |
| 活动客户 | 18347 |
| 导入任务 | 89 |

订单、历史、商品、客户、导入等核心表的原列数量和内容哈希与更新前一致。没有把测试订单或活动导入业务库。

业务服务上次停止于 11 月 2 日，恢复后按现有规则处理过期状态、展示快照和会话。因此 `activity`、看板/排行快照、事件发件箱、Flyway 历史及 H5 会话出现预期变化；不能声称业务启动后所有 49 张表哈希都不变。差异列表及核心表核对见 `verify-business.json`。

部署后检查了 11 个可公开访问活动的资料 200/304、看板/排行接口、H5 页面，以及未登录管理接口 401 和 3 张真实缩略图 200/304；原数据服务身份与挂载、`.env` 哈希再次核对一致。业务浏览器管理登录页正常，无脚本异常或 HTTP 500。最终仅 7 个业务容器运行，专项和端到端测试容器已清理，副本恢复容器已停止。

## 验证材料与人工检查入口

本机材料集中在 `outputs/local-release-20261105/`：

- 版本与部署：`release.json`、`release.compose.json`、`deployment.json`、`final-runtime.json`。
- 备份恢复与升级：`restore-verification.json`、`verify-upgrade.json`、`trial-rollback.json`、`trial-new.json`。
- 自动化：`frontend-container-final.log`、`backend-test-summary.json`、`reports-backend-unit/`、`reports-integration-*/`、`api-target/surefire-reports/`、`typecheck-root-final.log`、`typecheck-maintained-final.log`、`lint-maintained-final.log`。
- 真实功能与浏览器：`real-features.json`、`real-browser.json`、`real-browser-confirmed.log`、`browser-*.log`、`real-*.png`。
- 混合验证：`mixed-export.json`、`mixed-export.log`。
- 业务验收：`business-verification.json`、`verify-business.json`、`business-browser.json`。

人工检查请重新打开或强制刷新[管理后台](http://localhost:3000/admin)，沿用原账号。可以先检查活动切换、列表分页/刷新、排行确认及抽奖布局，再用专门的测试活动检查历史配置复用、归档/取消归档和结束后的 ZIP 导出。永久删除属于实际数据删除，请仅对确认可删除的测试活动操作。
