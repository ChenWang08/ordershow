# 本地启动/审计及订单号修复部署（2026-09-08）

已将通过108项完整回归、千人重测及60分钟常态长稳的同一镜像部署至本机`order-show`后端。仅重建backend，前端、MySQL、Redis、MinIO容器均保持不变。

- 当前镜像：`sha256:e49d692d218392f5619b11867200878e7e46301dc1dfb640fe68f8a869efb6d2`。
- 当前后端容器：`509d5d1ff8bb`。
- 原镜像保留标签：`order-show-backend:pre-startup-20260908-172600`。
- 原镜像ID：`sha256:9b3d69396fef83358b6e755e0603997066e83d6a4e7d10537b81fdc47ccb05af`。
- 测试前后运行输入摘要一致：`3E4BF11D8AA591063750817038FEC887BC444C1868D7AF9A4F1418A986167243`（后端主源码、迁移、POM、Dockerfile及OpenAPI文件路径/内容摘要）。

## 改动及检查

- 只读H5启动预热默认开启，`H5_WARMUP_ENABLED=false`可用于诊断；HTTP线程仍40、数据库连接池仍20。
- 后端readiness就绪前业务返回503；镜像新增健康检查，Compose前端等待后端健康。服务已部署并达到healthy，不需要用户再次手动重启。
- 同步批量审计保持原拦截范围和失败日志语义；并非订单与审计的原子事务。
- 新订单号使用ZY加完整UUID的Base36编码，最长27字符；已有订单号不变，无新增数据库迁移。
- 更新后readiness为UP；前端/admin、/h5及业务活动HD20260907004的看板API均HTTP200。
- 更新前后业务计数一致：customer_order 384、order_version 394、activity_product 892、activity_customer 4776、stored_file 622，Flyway版本024。
- 压测/E2E容器均已停止，专属测试数据卷、旧镜像和原始报告保留。未进行业务写入压测。

完整指标与失败保留记录见[测试报告](../testing/startup-audit-optimization-report.md)。千人场景是60秒内分批进入/各下一单；长稳是每秒20流程，不代表千人持续高频能力。200用户高频读取仍未达500ms目标。

本轮未进行浏览器视觉验收，未演练镜像回退；旧镜像保留不等于数据库备份。
