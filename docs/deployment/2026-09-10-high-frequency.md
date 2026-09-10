# 本地H5高频写入隔离部署（2026-09-10）

已将通过111项完整回归、200用户高频、千人正常峰值和常态预检的镜像部署至本机`order-show`后端。只重建backend，前端、MySQL、Redis、MinIO容器保持不变；无数据库迁移、无业务写入压测。

- 当前镜像：`sha256:77ee9ae9cb8ce089bb912042bc9110cf364566152ee0d4a78d1225f62d68d1fd`。
- 当前容器：`e0e238214909`。
- 原镜像保留标签：`order-show-backend:pre-admission-20260910`。
- 原镜像：`sha256:e49d692d218392f5619b11867200878e7e46301dc1dfb640fe68f8a869efb6d2`。
- 最终配置：虚拟线程开启、H5写许可12、数据库连接池20。

更新后readiness为UP，`/admin`、`/h5`及业务活动`HD20260907004`看板API均HTTP 200。更新前后计数一致：customer_order 384、order_version 394、activity_product 892、activity_customer 4776、stored_file 622、Flyway版本024。

所有隔离测试容器已停止，原始报告和四套A/B数据卷保留。完整指标及限制见[测试报告](../testing/high-frequency-admission-report.md)。本轮未重跑60分钟长稳，500用户持续高频写入未达标，未执行1000用户持续高频。

无需再次手动重启。旧镜像不是数据库备份，本轮未演练回退，也未进行浏览器视觉验收。
