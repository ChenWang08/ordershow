# 本地 ACK 镜像验证记录：20261019.1

日期：2026-10-19（Asia/Shanghai）。状态：本地构建及隔离验证通过；已推送 CODING 并核验远端摘要和平台，未部署 ACK。

## 合并与镜像

合并前 ACK 为 abfe179，合入 main 0825de6，包含 7d7641a（H5 通道切换重置客户上下文）、9d258ba（手动白名单及抽屉保存错误）、0825de6（UTC 存储与北京时间展示）。自动合并无冲突。镜像业务代码对应本次合并工作树；构建后的修改仅为文档、配置模板注释与验证脚本。

| 本地镜像 | 索引摘要 |
| --- | --- |
| order-show-ack-frontend:20261019.1 | sha256:08cc883f68d777e0cd54587d182c84c60d66314ef5be76e1a3f8bb102182eb50 |
| order-show-ack-backend:20261019.1 | sha256:36e228bd0091d7bbd8e73622d3d18780bf50ebb44a97787857f8bc0e83d19576 |

平台均为 linux/amd64。前端 NEXT_PUBLIC_API_BASE=/api/v1；后端 SKIP_TESTS=false。旧 20261015.1、20261012 镜像保留，后续已添加对应 CODING 标签并成功推送，镜像内容未变。

## 实际验证

- 前端构建与 223 项测试全部通过；类型检查和全项目 ESLint 通过。包含 H5 通道切换、抽屉保存和时间显示回归。
- 后端构建测试 192 项：161 通过、31 按环境条件跳过、0 失败。条件跳过的集成测试不计作已通过。
- 仅使用 order-show-ack-smoke。全新 DBA SQL 执行至 V039，未创建 Flyway 历史表；生成包与原 V039 版本无差异。
- 特意将隔离 MySQL 全局时区设为 +08:00、backend-b JVM 时区设为 Asia/Shanghai。新活动默认创建时间为 UTC，跨副本 API 时间保持一致并带 Z。通过 performance_schema 查询，两副本 40 条应用连接的会话时区全部为 +00:00。
- 双副本会话/CSRF、MinIO 上传下载与私有文件保护、两执行器单次发布导入任务、Redis SSE 广播、重启副本后会话保留均通过。
- 跨副本背景上传/读取/重置、重新开放订货及过期版本拒绝通过。
- node scripts/test-manual-additions.mjs --ack-smoke：91 项 API 状态断言及身份、持久化、拒绝检查通过。覆盖有类型/无类型白名单手动新增、重复数据拒绝及回滚、商品和参会新增、H5 验证、活动间隔离、不同活动状态限制。--ack-smoke 仅选择固定隔离端口和测试账号，不接受业务 URL。
- 前端 /admin、/h5、/screen/SMOKE/report HTTP 200。这是页面响应检查，不声称完成新的完整浏览器验收。
- test/cloud 配置 + 隔离带密码 Redis 启动通过，readiness HTTP 200/UP。OSS 使用 oss.invalid，仅检查配置启动，不代表真实 OSS 访问通过。

## ACK 兼容与数据库边界

保留本地 MySQL/Redis/MinIO 和云端 OSS 配置选择、云端关闭自动迁移及初始化。共享会话、Redis fanout、数据库任务领取/锁机制保留，没有增加进程本地任务状态或业务临时文件。连接池预算未变，云模板每副本 10；扩容仍需计入滚动更新的额外副本与 DBA 连接。

无新增 SQL/Java 迁移，数据库结构仍为 V039。已升级 V039 的云库无需重复执行；如果仍是 V038，DBA 按既有说明先执行 V039。不要执行空库包覆盖已有业务库。

UTC 修复不会自动校正历史时间。发布前由 DBA/部署团队使用 scripts/audit-time.sql 只读核查，结合该环境原始业务时间和写入版本判断；禁止批量统一减 8 小时，禁止套用 main 文档中只适用于原本地数据库的历史修正清单或备份。原本地历史校正工具不在当前交付内。

部署配置须保留 UTC 驱动及 Hikari 初始化设置；外部 DBA 写入会话也应显式使用 UTC。安排受控切换，避免旧后端和新后端同时写入不同时间口径。历史修正单独备份、审核、演练后执行，不由应用启动处理。详见 docs/deployment/2026-10-19-utc-time.md。

真实 ACK/PolarDB/托管 Redis/OSS、新旧版本切换、云端历史时间核查与完整浏览器验收仍待完成。本次未连接云端资源、未执行历史数据修改。

## 清理与回退

本次检查开始时原业务容器已停止；没有启动、重启或替换它们。原业务容器 ID：frontend ba2adb824d61、backend c3924fdfe540、redis 6a08bc666fbe、mysql 3dd238fecd02、minio a0a861a15813。

隔离测试完成后清理本次 smoke 容器和网络，保留新旧镜像。旧镜像可用于应用回退，但旧后端可能再次写入不同口径时间；若未来执行历史修正，回退镜像不会撤销数据修改，应由 DBA 单独评估，不能整库还原覆盖新业务数据。

## CODING 推送与交付

2026-10-19 前后端 docker push 均退出码 0；随后 docker buildx imagetools inspect 核验两个远端索引摘要与上表完全一致，业务平台均为 linux/amd64。仓库原有层已复用，缺少的层及元数据已上传。旧 20261015.1 标签未覆盖。

前端：`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-frontend:20261019.1`

后端：`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-backend:20261019.1`

用户确认 20261015.1 已部署测试环境；本次仅推送新版，未操作测试环境或数据库。部署团队需按上述 UTC 切换和历史时间核查要求安排更新，保留数据库、Redis、OSS 和业务密钥；已有 V039 不重复执行结构脚本。真实测试环境升级与验收待反馈。
