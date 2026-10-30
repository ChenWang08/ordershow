# 2026-10-30 本地部署：查询优化、订单汇总与提交兼容修复

最终验收时间：2026-10-30 **11:08（北京时间）**。目录 `E:\fengyi\order_show`，Compose 项目 `order-show`，前端 3000、后端 8080。本次仅更新本机，没有推送代码/镜像或操作远程环境。

## 当前版本

从干净 `main` 提交 `d36cbca506ad84b66fb6466543791535045575b2` 导出构建上下文，使用仓库标准 Dockerfile 构建。两个镜像均写入 `org.opencontainers.image.revision`，运行容器、镜像标签和该提交已核对一致。

| 服务 | 本次镜像标签 | 镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:local-d36cbca-20261030` | `sha256:1b6fd7856273d7e911450ebf9e1705d90a3a0b6ab3a2801e66e32ab390f486bb` |
| 后端 | `order-show-backend:local-d36cbca-20261030` | `sha256:33541726afac2ea2679532d251f3c45f53c4633f36c639a872c3a786e36d7539` |

两者的 `latest` 已同步，但后续追溯应以固定标签、镜像 ID 和提交标签为准，而不是只看 `latest`。`ac92fc625c3670cb529205bb1b6ab253ac0fb635` 是早期代码提交，不是当前运行版本；也不能将旧前后端都视为该提交的构建产物。

部署前保留的旧镜像：

| 服务 | 保留标签 | 镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:before-d36cbca-20261030` | `sha256:54ea850521ef3e23cd5c8d68438ee4aeb76f450c9869df46956cd1ecea1326ee` |
| 后端 | `order-show-backend:before-d36cbca-20261030` | `sha256:852d569e20b4603d6cbcfd0ae775e938be0530935262d5fd7b407df1617347f4` |

## 数据库和配置

- 原库 V039，已完整执行 V040、V041，现为 V041。V040 创建两张订单级汇总表；V041 移除逐明细触发器，不改写 V040。
- 升级由一次性迁移容器执行，迁移凭据未留在日常后端；日常数据库账号仍为 `order_show`，未给它额外授予 SUPER，也未调整全局日志信任设置。
- 日常 `.env` 已持久设置 `DASHBOARD_SUMMARY_ENABLED=true`，未限制活动白名单。本文件被 Git 忽略，不会随源码同步到其他电脑；仓库默认值仍为 false。
- 汇总开启时在业务事务内同步维护。关闭时读取原始明细且不维护汇总；关闭后有写入或裸 SQL 改明细，需要重新 `repair`、`check` 后再开启，不能直接切换开关。
- MySQL 容器重建以应用已测试的 `innodb_buffer_pool_size=536870912`（512MiB），MySQL 镜像版本未变，继续挂载原 `order-show_order-show-mysql` 数据卷。未清空或新建业务数据卷。
- 后端池大小 60、HTTP 线程配置 60、H5 写入准入 36；Redis、MinIO 保持原有容器和数据。

## 已执行的更新顺序

1. 保留旧镜像、原 `.env`、Compose 和运行配置；旧系统运行期间先构建新镜像。
2. 核对新后端包与已测试包：422 个 `BOOT-INF` 文件的程序/依赖/资源内容一致，其中 39 个 SQL 文件仅 CRLF/LF 换行不同。部署包 SHA-256 为 `fff02b43fbe61da0571195c6c41285ca82add5b829151b0289be0cdc21399fd2`，不能将它与压测包整体哈希写成相同。
3. 停止业务前后端，导出一致数据库备份；在隔离 MySQL 的新库还原，44 张表的数量及 CHECKSUM 全部一致。
4. 应用数据库缓存配置，执行 V039→V041，核对业务数据不变。
5. 前后端仍停止时，对全部 11 个活动执行汇总修复与逐单对账：456 笔订单、差异 0。
6. 持久启用汇总，启动新后端，等待健康后启动前端；完成接口、只读浏览器及业务数据核验。

## 部署后验证

- 后端 readiness 为 `UP`；前后端运行镜像与上述 ID、revision 一致。
- 456 个订单均有汇总，无缺失、无 dirty 行；汇总修复和检查差异为 0。
- `customer_order`、`order_item`、`order_version`、`order_version_item`、`order_operation`、`api_idempotency`、`activity_dashboard_snapshot`、`activity`、`activity_product`、`activity_customer`、`customer` 共 11 张表，在升级、回填、服务启动及最终只读检查后，数量和 CHECKSUM 均与停写备份时相同。
- 当前活动金额榜、吨数榜、订单看板、总战报均返回 200，金额、数量、单数与数据库一致。
- 实际浏览器确认后台登录表单、当前活动 H5 通道入口、看板数据正常加载；未提交管理员登录、手机号验证或测试订单。真实业务写入流程的正确性来自部署前隔离测试，不把页面打开描述为真实下单验证。
- 本次功能回归与压测边界见[测试报告](../testing/local-summary-validation-2026-10-30.md)。本机部署不代表其他电脑、远程服务或 30 并发容量已通过。

## 备份与证据

备份目录：`E:\fengyi\order_show\backups\20261030-d36cbca-before-summary\`。

- `database-v039.sql`：61,030,858 字节；SHA-256 `b2e9e48688292c8ca29e253f0d01878a5b36fb826b62e87e439a5c2f2fb67d54`。
- 已在隔离库 `order_show_restore_20261030` 成功还原并核对全部 44 张表。该还原库位于测试环境，不是业务服务连接目标，也不替代磁盘 SQL 备份。
- `env-before.private`、`containers-before.private.json`、`compose-before.private.json`、`docker-compose.before.yml`：原配置；包含敏感配置的文件不得纳入 Git 或公开分享。
- `source.tar`：该提交的构建源码快照；`deployment-result.json`：最终部署验收记录。

完整构建、包内容核对、迁移、逐活动修复/对账和验收证据位于 `outputs/local-deploy-20261030/`；这两个目录均被 Git 忽略。本说明只记录脱敏结果，不携带数据库内容、凭据或会话。

## 恢复注意事项

关闭汇总只是切换读取并停止正常维护，**不是回滚程序或数据库**。旧后端与新版本的按需历史快照实现不同，不能假设仅换旧镜像就安全兼容升级后新增的数据。

需要恢复时：

1. 先暂停业务前后端，保存故障现场和升级后的新备份，确认是否已有新订单/修改。
2. 若已有新写入，不可直接用旧备份覆盖；先明确增量保留或恢复方案并确认数据损失范围。恢复本次 V039 备份会把数据库回到备份时点，不能保留之后的写入。
3. 在新的隔离库/数据卷中还原上述备份，核验完整性，再配套使用保留的旧镜像和原配置。未验证前不删除原业务卷，不运行 `down --volumes`，不手改 Flyway 历史以伪装降级。
4. 核对连接目标、原 Redis/MinIO 配置及文件引用后再恢复业务入口；新的恢复动作需单独执行和验收。

本轮验证了备份可还原，未实际回滚业务系统。旧镜像与备份已保留供必要时恢复。
