# 活动清理：索引分批删除、暂停与重试进度

日期：2026-11-05（北京时间）。共享修复来源为 ACK 提交 `c9e6e054581bd67fc14b87a40ce419969b46f454`。本轮同步清理代码、测试、V054 迁移及本地配置到 main，保留 main 原有部署与存储配置；未构建、上传或部署业务镜像，未连接线上数据库或对象存储。以下“ACK 首轮验证”为来源分支结果，main 独立复测结果单列。

## 现场与结论边界

活动 HD20261027003 的任务 1 曾返回 RUNNING、stage=10、deletedRows=415282、deletedFiles=0，并带通用错误。最终在 19:06:15.598 完成，共删除 434394 条数据和 213 个文件，自 18:52:18.433 创建约 13 分 57 秒。HTTP 200 只说明进度读取成功，中途红字并不代表整个任务已停止。

第 10 阶段为 order_item。原 `DELETE ... WHERE order_id IN (SELECT id FROM customer_order WHERE activity_id=?) LIMIT ?` 在隔离 MySQL 8.4 中使用 ALL 扫描明细、对父表作 DEPENDENT SUBQUERY；500 的 LIMIT 限制删除数，不能限制扫描数。其他同构的关联明细也存在此风险。现场日志不可取得，不能断定当次异常一定是超时、锁等待或该执行计划；最终完成证明后续有成功推进。

## 修改

1. 所有 11 个关联明细阶段由目标活动的父表驱动 STRAIGHT_JOIN，经外键索引选择最多 batch-size 个子表主键，在同一批事务中按这些主键删除。兼容 order_dashboard_stat 的 order_id 主键和经销商范围/成员的复合主键；无新业务索引或外键关闭。直接带 activity_id 的阶段保持按活动限量删除。
2. 不重排阶段，不重建任务。原第 31 阶段解除到场导入版本引用的逻辑保持，既有失败或暂停任务可从原阶段继续。
3. 新增仅超级管理员可调用的 POST `/admin/activity-deletion-tasks/{id}/pause`、`/resume`，与原 `/retry` 分开。暂停事务等待当前批次持有的任务行锁，提交 PAUSED 后所有副本不再领取；在途批次提交结果保留。暂停幂等；继续仅允许 PAUSED，重试仅允许 FAILED；完成任务不能恢复。操作有独立审计记录，活动的删除标记及读取/写入拦截保持。
4. 失败落库继续按修订号校验，且只更新 QUEUED/RUNNING，防止旧批次异常覆盖暂停、继续或完成状态。成功批次更新 last_progress_at；失败、手动暂停与恢复不伪报业务推进。成功批次包含清单游标、解除引用及空表后的阶段推进，不只统计已删行数。
5. 页面显示具体步骤/阶段编号、最近推进时间、当前批连续失败次数/上限及下次尝试时间；自动重试使用状态提示，只有 FAILED 使用终止错误提示。暂停和失败停止轮询，继续后恢复；隐藏页面/关闭仍中止读取。暂停请求期间显示等待当前批次结束，防止重复提交。暂停不撤销已删数据，活动仍不可用。
6. 默认每批 500、间隔 500ms、连续失败上限 5 次，SQL 超时仍为 10 秒；保留退避等待（2/4/8…最多 60 秒）。所有副本共用一个数据库批次协调锁，不增加清理并发或连接池。MinIO/OSS 实现、共享会话、事件广播和临时文件处理未改变。

## 数据库与发布

新增 V054 SQL，不修改既有迁移。扩展 ck_deletion_status 允许 PAUSED，增加 last_progress_at，已有任务按原 updated_at 回填。回填是历史最佳已知时间，不能追溯以前的真实成功批次。

main 新增 `db/migrations/V054__activity_deletion_pause_and_progress.sql`，本地保留原 Flyway 迁移方式。以后更新本地应用时迁移至 V054；本次不启动业务应用，不迁移现有业务库。云端有序 DBA 包保留在 ACK 工作树 `deploy/dba/generated/upgrade-v053-v054.sql`，不复制 ACK 部署目录到 main；停止所有 API/worker、备份并核对实际 V053 后由 DBA 执行，DDL 可能隐式提交，遇错即停。已有 V049 先按序升至 V053 再执行本包；无新增 Java 迁移，V037 规则保持。ACK 的 test/prod 自动迁移继续关闭。

main 的 `.env.example`、公共 application.yml 及本地 Compose 提供 ACTIVITY_DELETION_BATCH_SIZE、ACTIVITY_DELETION_MAX_RETRIES、ACTIVITY_DELETION_BATCH_INTERVAL_MS，默认值不变，所有 API 副本应一致。没有增加连接预算。已交付 20261105.1 镜像及版本化交付包未更新，后续发布需统一更新前后端。

## 验证

- 前端专项 15 项通过，0 失败/跳过；活动生命周期与全项目类型检查通过。覆盖暂停/继续、轮询停止/恢复、自动重试与终止提示、操作等待/失败及重复点击保护。
- 真实浏览器在 1440、440、320 宽度通过；新增暂停及自动重试页面截图已检查。原归档、删除确认、两类部门角色、空/错误/加载状态入口检查通过。接口使用替身，不代表真实 ACK HTTP 验收。
- DBA V053→V054：4 种既有任务的字段与 worker 行保持，最近推进时间回填、PAUSED 约束通过；升级后与 V054 新空库的 57 张表结构逐表一致，源 SQL 与包 SHA-256 通过。全部为合成数据，无云端 SQL。
- 后端最终同组 **20 项通过、0 失败、0 错误、0 跳过**：ActivityLifecycleIntegrationTest 18 项、StorageDeletionTest 2 项，执行 V001～V054 全部迁移（包括 V037 Java 迁移）。覆盖原生命周期用例、暂停跨 worker 持久化/恢复、在途批次暂停、多 worker 停止领取、其他任务继续、11 个关联阶段的索引执行计划、无关活动行锁隔离、失败上限与有效推进时间。含 1201 条订单明细的完整分批清理和复合主键范围数据；所有批次实际删除数不超配置上限，其他活动、客户主档及账号保持。

测试采用项目名 order-show-ack-smoke 的专用临时 MySQL 8.4 容器，端口固定 33326、内存文件系统、无业务数据卷；Maven 只编译和测试。使用已有 Maven 缓存，不修改业务容器。存储服务使用替身，本轮不验证真实 OSS 删除或文件服务延迟。首轮 Java 方法引用编译歧义及前端测试跨运行环境 Error 夹具已修正；首次数据库整组有 8 项因重复插入测试范围数据报错，次轮有 1 项因手动跳过第 0 阶段的测试收尾遗漏文件清单而失败。夹具修正后，以最终源码重跑完整 20 项全部通过，不把中间失败算通过。

ACK 原始报告与 DBA 检查在 ACK 工作树忽略目录 `outputs/ack-deletion-fix-20261105/`；浏览器结果在 `outputs/activity-lifecycle-browser/`。复跑后端沿用既有 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only`、固定测试库和测试端口；禁止与同库其他测试并行。

验证结束已删除本轮专用临时 MySQL 容器，内存中的合成库随之销毁；未操作其他并行任务的 smoke 服务。核对 43 个原有非 smoke 容器的 ID、镜像与运行状态保持。最终 Surefire XML 和数量摘要保存在 `final-reports/`、`backend-summary.json`，全项目类型检查退出码为 0，`git diff --check` 通过。未执行全站回归或生产规模压测。

## 真实云端待验

真实 PolarDB 的 DDL/执行计划/锁等待、生产规模清理耗时、OSS 删除权限/超时、多 API 副本暂停/继续、滚动发布和手动扩缩副本均待部署团队 UAT 验证。本机验证不构成现场异常根因证明或线上容量承诺。

## main 同步验证

同步范围不含 ACK ConfigMap、云端 profile/存储实现、镜像清单、DBA 打包脚本或发布记录。公共配置仅新增三个清理参数，保留 main 的本地 MySQL/Redis/MinIO 及原 Flyway 设置。本轮不构建镜像、不推送 Git 或部署，不启动、修改或重启原业务容器。

- main 真实 MySQL 专项：ActivityLifecycleIntegrationTest 18 项、StorageDeletionTest 2 项，合计 **20 项通过、0 失败、0 错误、0 跳过**；V001～V054 全部迁移实际执行，含 V037 Java 迁移。覆盖暂停/续跑、在途批次提交、多 worker、原第 31 阶段兼容、全部关联步骤索引与其他活动行锁隔离。
- main 前端专项 **15/15 通过**；活动生命周期及全项目类型检查通过。1440/440/320 浏览器检查与暂停/重试截图复核通过，接口使用替身，不能代替真实云端验收。
- 10 个共享生产代码/测试/迁移文件与 ACK 来源逐文件一致；三个公共配置文件仅增加清理参数。main 原有部署文件与云端配置边界保持，没有引入 ACK cloud profile。
- 本轮专用 ACK smoke MySQL（33326、合成数据、内存文件系统）已清理；核对 43 个原有非 smoke 容器的 ID、镜像与运行状态保持。未运行全站回归或生产规模压测。
- main 日志、Surefire XML、数量摘要及范围/清理检查保存在 ACK 工作树忽略目录 `outputs/ack-deletion-main-sync-20261105/`；浏览器截图在 main 工作树 `outputs/activity-lifecycle-browser/`。
