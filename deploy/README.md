# 本地源码验证与部署说明

## 2026-11-09：预览与审核 HTTP 活动锁同步

已从 ACK 提交 `fbc9f39991c6c56f3278deba4950b18ad3cc6779` 同步共享业务修复、两个回归测试类和隔离复跑配置。只将两类预览及审核通过/驳回的 POST 入口改用活动共享锁，保留原 READ COMMITTED 事务与状态检查、同客户串行和全活动操作排他保护。相同数据库下的副本通过 MySQL 锁协调，没有新增连接池、共享状态、临时文件或迁移。

main 源码同步完成；已恢复并核验中断会话留下的 12 份测试报告，合计 115 项全部通过、无跳过。控制台日志未保留最终 Maven 摘要及退出码，结果以完整 XML 报告为依据。来源证据、复跑方式和待真实云端验证项见[HTTP 活动锁验证记录](../docs/testing/activity-write-lock-http-2026-11-09.md)。本次仅同步源码，保留本地 MySQL/Redis/MinIO、存储选择和本地部署配置；没有构建、推送或部署镜像，没有启动或重启业务容器。ACK 镜像交付配置仍由 ACK 分支管理。

## 2026-11-09：抽奖与审核修复同步

本地 `main` 已同步 ACK 提交 `cecc235` 的抽奖候选查询、订单变更审核锁及执行序号显示修复。源码同步不等于部署，本次未构建或部署镜像；本地当前运行版本见[项目部署记录](../README.md)。没有新增迁移、环境变量或连接池预算，本地 MySQL、Redis、MinIO 及配置选择 OSS 的支持保持适用。

本次后端 72 项（含真实 MySQL 查询、HTTP 及审核并发）和前端 30 项检查全部通过，均无跳过。验证结果、来源记录和真实环境覆盖边界见[修复验证记录](../docs/testing/lottery-review-fix-2026-11-06.md)。`verify/lottery-review.compose.yaml` 仅用于独立 ACK smoke 源码测试，不是业务部署配置：

```powershell
docker compose -f deploy/verify/lottery-review.compose.yaml run --rm tests
docker compose -f deploy/verify/lottery-review.compose.yaml down -v
```

复跑要求 Docker 可用、端口 `127.0.0.1:33316` 空闲，以及配置指定的缓存镜像和 `order-show-m2` 依赖卷已准备。测试只使用固定测试库和独立匿名卷，结束后仅清理该项目；不要将测试连接指向业务数据库，也不要为本次验证修改或重启现有业务容器。

ACK 镜像发布、配置模板及 DBA 迁移交付继续由 `E:\fengyi\order_show-ack` 分支管理，本次未将其云端交付配置并入本地 main。
