# 20261106.1 数据库增量升级（V053 → V054）

用户已确认现有云端为 V053，本次发布只需执行本目录 V053→V054 增量。本轮没有连接或修改云库。

- 已有 V053：停止全部 API/worker 和其他写入者，DBA 备份并核对版本后只执行 `upgrade-v053-v054.sql`。已应用的 V001～V053 不重新执行，已有环境不执行空库安装。
- 已有 V049：另取仓库 `deploy/dba/generated/upgrade-v049-v053.sql` 及 manifest，核验 V053，再执行本包 V054。其他版本先由 DBA 选择正确的有序路径；本目录不能直接跳过前置版本。
- 新空库：另取仓库 `deploy/dba/generated/fresh-install.sql` 和 `manifest.json`，目标 V054，不在本次已有库增量包附带。正式业务数据重新导入，不复制本地卷；管理员初始化按原 DBA 说明处理。
- 本目录只保留 `upgrade-v053-v054.sql`、对应 manifest 及 `source/V054__activity_deletion_pause_and_progress.sql`。manifest 保存包/源 SHA-256，源以 UTF-8/LF 规范化计算；包根 `SHA256SUMS` 核对传输完整性。历史源迁移继续保留在仓库原有目录。
- V054 增加 PAUSED 约束和 last_progress_at，既有任务按原 updated_at 回填；不代表能够还原原真实成功批次时间。原任务/worker 行应保留。
- 没有新增 Java 迁移；已有 V053 升级 V054 不重跑 V037。只有涉及更早版本的历史数据升级时，DBA 才需按原说明审核仓库中的 V037 Java 清理；空库规则不能替代历史数据处理，也不能由应用自动执行。
- DDL 可能隐式提交，遇错立即停止，不用 `--force`；应用 test/prod 的 Flyway、历史启动迁移和初始化继续关闭，使用普通 DML 账号。
- 本机合成 V053→V054 与 57 张表空库结构对照已通过，真实 PolarDB 权限、耗时和恢复演练待执行。回退需先处置 PAUSED 并停止全部执行者，不提供通用破坏性降级 SQL。
