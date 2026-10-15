# DBA 数据库交付

## 本次范围

测试、生产都是新库，业务数据重新导入，不迁移本地数据。目标为 PolarDB MySQL 兼容版，需具备 MySQL 8 的 CHECK、JSON、窗口函数和 SKIP LOCKED 等能力。具体集群版本须在测试环境验证。

应用在 test/prod 配置下关闭 Flyway、旧数据迁移、演示数据及管理员自动创建；数据库结构由 DBA 管理。应用账号只授予业务库的 SELECT/INSERT/UPDATE/DELETE，不授予 DDL 权限。

## 首次安装顺序

1. 在所交付源码根目录运行 `node scripts/package-dba.mjs`，离线生成 `generated/fresh-install.sql` 和 `manifest.json`。
2. DBA 创建独立空库，字符集 `utf8mb4`、排序规则 `utf8mb4_0900_ai_ci`，确认数据库名和 `SHOW TABLES` 为空。脚本只用于空库，不可对已有数据运行。
3. 审核 manifest 中来源脚本及 SHA-256（源文件按 UTF-8/LF 换行规范化计算，SQL 包固定 LF，保证 Windows/Linux 一致），备份必要信息后，在同一个客户端连接执行 fresh-install.sql。遇错立即停止，不使用 `--force`，不要跳过失败语句继续。
4. V037 是 Java 数据清理迁移，无表结构变更。空库没有商品和预览数据，因此此次明确记为不适用；不能将此处理方式用于已有数据库升级。
5. 用离线工具生成初始管理员 BCrypt 哈希，填写 `bootstrap-admin.sql.example` 的私有副本后执行。默认部门由 V017 创建，正式活动由管理员登录后创建，不插入本地演示活动。
6. 检查 `deployment_schema_history` 为 V039、管理员数量为 1，启动应用后验证健康检查、登录及首次改密，最后导入审核后的正式数据。

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
