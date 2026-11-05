# DBA 数据库交付

## 当前结构：V053（20261105.1）

- 先核对目标数据库及 deployment_schema_history；只有实际 V049 才使用 generated/upgrade-v049-v053.sql。已有 V041 先执行原 V041→V049 包；其他版本逐版本审核。新空库使用更新后的 fresh-install.sql。
- V050 抽奖规则版本；V051 删除标记与清理任务；V052 异步导出；V053 活动配置复制。没有新增 Java 迁移。V037 对空库无数据可处理的历史规则保持，不能用空库包升级已有库。
- 停止所有 API 写入、导入、复制、删除及导出执行者，备份并确定数据库与 OSS 恢复方案；按序执行，遇错即停，不使用 --force。MySQL DDL 可能隐式提交，不能假定失败已事务回滚。
- 核验每个源脚本和包 SHA-256，成功后最大版本 V053，新增表/列和三个 worker 初始行完整。应用保持 Flyway 关闭、DML 账号无 DDL 权限，云端不创建伪造 flyway_schema_history。
- 本轮隔离测试会验证 V049 合成历史数据升级和 V053 空库安装；真实 PolarDB 执行耗时、权限、备份恢复由部署团队验收。
- 旧镜像标签保留不等于可直接回退。永久删除会删除数据库记录及 OSS 对象；发生新写入后，由 DBA 评估结构/数据兼容性，保存升级后新增写入，再执行已经验证的回退或恢复方案。

以下为历史升级说明：


## 本轮结构：V049（20261101.1）

新空库安装包已包含 V001～V049（V037 Java 清理对空库不适用）。已有 V041 库由 DBA 执行 `generated/upgrade-v041-v049.sql`，配套 manifest 记录 8 个源脚本及包 SHA-256；V039 库先执行原 `upgrade-v039-v041.sql`，再升到 V049。不要在已有库执行空库包。

升级前确认 `deployment_schema_history` 的版本、结构及目标库；暂停所有应用写入、导入和维护任务，备份并验证恢复方案。只执行尚未应用的版本，遇错立即停止；DDL 不保证事务回滚。V048 会插入起始箱数为 1 的独立价格档、使目录版本失效并影响活动元数据时间，原订单/历史金额及已有优惠档应核验保持一致。

升级后确认 V049、手机号查询索引、阶梯价格新列/约束、零明细触发器，应用 Flyway 继续关闭且不创建伪造 Flyway 历史。逐活动执行新镜像的 repair/check、差异 0 后恢复服务。已有汇总全量有效时也必须执行 check；只有需要修复时才 repair。

恢复需同时评估价格规则与写时复制历史；不能假定仅换回旧镜像即可恢复。先保留升级后备份及新增写入，再由 DBA 确认独立还原或兼容恢复方案。本机隔离验证不替代真实 PolarDB 的 DDL 权限、版本和执行耗时验收。

## 本次范围

首次测试、生产安装使用新库，业务数据重新导入，不迁移本地数据；若已有 V039 云库，使用本文增量流程。目标为 PolarDB MySQL 兼容版，需具备 MySQL 8 的 CHECK、JSON、窗口函数和 SKIP LOCKED 等能力。具体集群版本须在测试环境验证。

应用在 test/prod 配置下关闭 Flyway、旧数据迁移、演示数据及管理员自动创建；数据库结构由 DBA 管理。应用账号只授予业务库的 SELECT/INSERT/UPDATE/DELETE，不授予 DDL 权限。

## 首次安装顺序

1. 在所交付源码根目录运行 `node scripts/package-dba.mjs`，离线生成 `generated/fresh-install.sql` 和 `manifest.json`。
2. DBA 创建独立空库，字符集 `utf8mb4`、排序规则 `utf8mb4_0900_ai_ci`，确认数据库名和 `SHOW TABLES` 为空。脚本只用于空库，不可对已有数据运行。
3. 审核 manifest 中来源脚本及 SHA-256（源文件按 UTF-8/LF 换行规范化计算，SQL 包固定 LF，保证 Windows/Linux 一致），备份必要信息后，在同一个客户端连接执行 fresh-install.sql。遇错立即停止，不使用 `--force`，不要跳过失败语句继续。
4. V037 是 Java 数据清理迁移，无表结构变更。空库没有商品和预览数据，因此此次明确记为不适用；不能将此处理方式用于已有数据库升级。
5. 用离线工具生成初始管理员 BCrypt 哈希，填写 `bootstrap-admin.sql.example` 的私有副本后执行。默认部门由 V017 创建，正式活动由管理员登录后创建，不插入本地演示活动。
6. 检查 `deployment_schema_history` 最大版本为 V049、管理员数量为 1、`dashboard_item_*` 触发器为 0，启动应用后验证健康检查、登录及首次改密，最后导入审核后的正式数据。新库模板开启汇总，新订单在业务事务内维护汇总。

## 20261030.1：已有 V039 升级至 V041

1. 先确认目标库、备份及恢复方案，停止所有旧/新后端、导入和其他写入者；不要滚动混跑旧写入端。确认 `MAX(version)` 为 V039、两个 `order_dashboard_*` 表均不存在。生成脚本没有自动判定环境的保护，这些检查必须由 DBA 执行；不是 V039 时停止并重新评估。
2. 执行 `generated/upgrade-v039-v041.sql`，核验相邻 manifest 的 SHA-256。V040 建两个派生表及三个触发器，V041 随即移除触发器；DBA 迁移账号需要相应 DDL/TRIGGER 权限。具体 PolarDB 权限需预演，不给应用账号提权，不修改全局信任设置绕过权限。遇错立即停止，不使用 `--force`；DDL 不保证回滚。
3. 验证最大版本 V041、两个表存在、三个触发器不存在。已有订单此时还没有汇总，不能把“建表成功”当作“汇总已补齐”。
4. 使用新后端镜像的维护命令，注入目标库的普通 DML 账号。查询 `SELECT id FROM activity ORDER BY id`，对每个活动从 afterOrderId=0 顺序执行 repair，再 check；没有订单的活动允许 checked=0。该命令不启动 HTTP、Flyway、后台任务或管理员初始化。输出必须 differences=0；中断后可按日志 nextAfterId 续跑，最终 check 仍从 0 全量核对。保留日志。

```sh
# 在已配置 DB_URL/DB_USERNAME/DB_PASSWORD 的受控维护容器内执行：
java -Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher repair ACTIVITY_ID 0
java -Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher check ACTIVITY_ID 0
```

5. 设置 `DASHBOARD_SUMMARY_ENABLED=true`，所有后端统一新版本后恢复服务，复核订单、历史及看板。云端仍保持 Flyway 禁用。配置变更需要重新创建 Pod 才生效。

V041 后直接 SQL 修改订单不会自动标脏；旧程序或关闭汇总期间的写入也不会维护汇总。发生这些情况时停止相关写入，重新 repair/check 后再开启汇总。历史活动展示快照与订单派生汇总是不同数据，本流程不改历史快照业务口径，也不照搬本地活动修正清单。

本次订单历史采用写时复制，新版本写入后不能只换回旧镜像。回滚前须验证历史数据兼容性；恢复备份意味着放弃备份之后的数据，必须经业务确认并制定处理方案。

离线生成密码哈希（命令行不包含密码，不连接数据库）：

```sh
docker run --rm -it --entrypoint java BACKEND_IMAGE \
  -Dloader.main=com.fengyi.ordershow.maintenance.BootstrapPasswordHash \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher
```

## 后续升级与故障处理

- `db/migrations/` 是 SQL 来源，按版本号递增审核执行，只运行未执行版本；保存文件校验和、应用镜像版本、执行人和结果。新增版本后将记录写入 `deployment_schema_history`。
- DBA 记录与本地 Flyway 历史独立；云端不建立伪造 Flyway 校验和，不重新打开自动迁移。
- 若升级范围包含 Java 数据迁移，必须先交付经验证的 SQL/专用 DBA 方案，不能仅按目录 SQL 列表跳过；打包脚本遇到新的 Java 迁移会拒绝生成。
- MySQL DDL 可能隐式提交。失败时检查实际已执行对象，不能假设事务已撤销；在确认全新且无业务数据的前提下，由 DBA 决定重建空库后重试。
- 应用回滚只适用于数据库结构向后兼容时。结构回滚或恢复备份必须由 DBA 评估，不在应用启动或 K8s 模板中执行。

## 2026-10-15 增量升级

已有 V038 云库由 DBA 在应用更新前执行 `db/migrations/V039__activity_backgrounds.sql`，增加活动背景引用及文件用途约束，然后记录 V039 到 `deployment_schema_history`。不要在已有库执行 fresh-install.sql。此次无新增 Java 迁移；V037 空库不适用规则不变。DDL 不保证事务回滚，执行失败必须检查实际结构后再处理。
