# 本地 ACK 镜像验证记录：20261027.1

日期：2026-10-27（Asia/Shanghai）。本地构建与隔离验证通过；未推送 CODING，未部署 ACK。

## 合并与镜像

ACK 从 723751d 合入 main 34d73b1，无冲突，新增两项提交：510767a（恢复公司 90/分公司 30 排行默认值及相关排行修复）、34d73b1（商品导入项目组筛选）。不是三个提交。

| 本地镜像 | 索引摘要 |
| --- | --- |
| order-show-ack-frontend:20261027.1 | sha256:137c6d07cfdde4236a2d5821fcfa1f705c8a9d3b578d67e7febfeba5c556ea02 |
| order-show-ack-backend:20261027.1 | sha256:d4ae85c6577506fd3efd8161ccee6fcca544646ae1b84155f0419c7982216001 |

平台均为 linux/amd64。前端 NEXT_PUBLIC_API_BASE=/api/v1，后端 SKIP_TESTS=false。保留 20261019.1、20261015.1、20261012 旧镜像；没有添加 CODING 标签或推送。

## 验证结果

- 前端 252 项测试全部通过，类型检查、ESLint 与镜像构建通过。
- 后端构建测试 198 项：162 通过，36 按环境条件跳过，0 失败。
- 单独运行真实 MySQL 榜单集成测试：10 项全部通过，无跳过。覆盖 0/20/22/89/90/91 公司数量、分公司上限、筛选、吨数缺失、自定义上限及历史快照重建。使用隔离 MySQL 的专用 order_show_ranking_test 库，没有使用业务库。
- 首次榜单测试因测试 ObjectMapper 使用数字时间戳而在 MySQL JSON 中丢失小数精度，快照比较失败；改用与 Spring 一致的 Jackson2ObjectMapperBuilder ISO 时间序列化后通过，并重新构建最终后端镜像。
- 项目组筛选真实 React 浏览器检查通过：组合筛选、空组、分页/选择重置、筛选后全选、组删除、活动切换、只读/预览，以及 1920/1280/768/390 宽度；无未捕获页面错误或业务 API 请求。使用合成数据和已安装 Edge，不等同于云端完整验收。
- 最终镜像双副本验证通过：共享登录/CSRF、MinIO 上传下载及私有文件保护、双执行器单次发布导入、Redis SSE 广播、重启副本后的会话、背景上传读取重置、重新开放与过期版本拒绝。
- MySQL 全局时区 +08:00、backend-b JVM Asia/Shanghai 下，跨副本 API 与数据库默认时间 UTC 检查通过。
- 手动新增回归：91 项 API 状态断言及身份、持久化、拒绝检查通过。
- 前端 /admin、/h5、/screen/SMOKE/report 均 HTTP 200。test/cloud 配置与带密码 Redis 启动通过，readiness HTTP 200；OSS 使用 oss.invalid，仅验证配置启动。
- DBA 空库 SQL 在隔离环境执行至 V039，未创建 Flyway 历史表，SQL 生成包无变化。

## 数据库与部署边界

无新增 SQL/Java 迁移，结构仍为 V039。已有 V039 不重复执行结构脚本，禁止在已有业务库执行 fresh-install.sql。

新建活动使用 90/30；已有活动上限和历史快照不会由镜像更新自动修正。DBA 应按[排行部署说明](../docs/deployment/2026-10-27-ranking-limits.md)先预览目标环境，再按审核名单处理旧默认 20/20 与 FINISHED 展示快照；保留自定义值，ARCHIVED 不自动处理。不得照搬原本地活动名单或数据库；本次没有执行云端数据变更。

保留此前 [UTC 部署要求](../docs/deployment/2026-10-19-utc-time.md)，历史时间核查和修正由 DBA 单独审核。共享业务代码、本地 MySQL/Redis/MinIO 和云端 OSS 选择均保留；云端关闭启动迁移和初始化。没有新增进程内共享状态、任务执行器或连接池预算；扩容需保留滚动更新副本和 DBA 连接余量。

真实 ACK、PolarDB、托管 Redis、OSS、新旧版本切换和云端业务验收仍待完成。

## 复现与清理

隔离配置默认使用 20261027.1。先启动 mysql/redis/minio，再用 `docker build --platform linux/amd64 -f deploy/verify/Dockerfile.ranking .` 运行数据库专项测试。MySQL 仅绑定本机 18306，数据为 tmpfs；专用测试库不会进入镜像。浏览器脚本可通过 ORDER_SHOW_PLAYWRIGHT_MODULE 指向已安装 Playwright，并设置 ORDER_SHOW_BROWSER_CHANNEL=msedge。

测试完成后清理 order-show-ack-smoke 容器与网络，保留镜像。原业务容器未被重启或替换：frontend ecfe27074903、backend 57fead8172fe、redis e3e3f8a56e36、mysql c551a1656a90、minio a0a861a15813。未读取或复制业务数据卷。
