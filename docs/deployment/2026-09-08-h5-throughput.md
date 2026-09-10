# 本地H5吞吐优化部署（2026-09-08）

约15:13（Asia/Shanghai），将已通过完整回归及隔离压测的同一镜像更新至本机`order-show`后端。仅重建backend，前端、MySQL、Redis、MinIO均保持原容器。无新数据库迁移，无业务写入压测。

- 当前后端镜像：`sha256:9b3d69396fef83358b6e755e0603997066e83d6a4e7d10537b81fdc47ccb05af`。
- 后端容器：`7bd5f39323d1`。
- 原镜像保留标签：`order-show-backend:pre-h5-20260908-151300`，原ID：`sha256:f01cce982495372376a1a13d96c1145d209ae4e7e2c7609a75874652a059b5c2`。
- HTTP工作线程默认上限40，通过Compose的`HTTP_MAX_THREADS`可配置；数据库连接池默认仍20。线程数不是在线人数限制。
- MySQL批量写入重写开启，当前与历史明细每批最多100行，保持原事务。

## 验证

- 后端健康：UP；前端`/admin`、`/h5`以及业务活动`HD20260907004`的看板API均HTTP 200。
- 更新前后计数一致：customer_order 384、order_version 394、activity_product 892、activity_customer 4776、stored_file 622、Flyway版本024。
- 后端97项测试全部通过，无跳过，包括隔离API E2E、真实MySQL批量回滚/锁及H5读取作用域。
- 隔离压测结束后PENDING队列0；负载和E2E环境均已停止，卷与输出报告保留。

性能改善及未通过门槛详见[H5优化报告](../testing/h5-throughput-optimization-report.md)。最终200用户混合高频读P95仍604ms，启动读取延迟仍不达标；没有升级500/1000用户高频，也未重跑60分钟长稳。

原镜像保留不等于数据库备份；本轮未演练回退。页面检查为HTTP可访问性，不是浏览器视觉验收。服务已经更新，无需再次手动重启。
