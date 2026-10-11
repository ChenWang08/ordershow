# H5 增量直提与减量审核本机更新（2026-10-10）

已更新本机业务 Docker Compose 项目 order-show 的 frontend（3000）和 backend（8080）。规则与隔离测试见 [实现说明](../testing/h5-increment-review-2026-10-10.md)。

## 数据保护

更新前以 mysqldump --single-transaction 备份业务库到 Git 忽略目录：

`backups/2026-10-10T07-38-19-820Z-before-h5-increment/database.sql`

备份约 55.9 MB；旧前后端镜像已保留 before-h5-increment 时间标签，镜像标识记录在同目录 images.json。

仅重建并替换 frontend/backend；MySQL、Redis、MinIO 容器及持久化卷保留。更新前后管理员 4、活动 8、订单 425，Flyway 保持 V037，本次没有新增迁移。

## 当前镜像

- frontend：`sha256:1a84fba2cd78d4d49eb36d48a35a7afbe6f02981c12ec1ca66087a4410e217b5`
- backend：`sha256:726950fa3b06d58328e7b873637bc7b1a97586d1f60b379bcadfc3998f78e4d5`

## 更新后验证

- 后端健康 UP；管理后台和 H5 入口 HTTP 200。
- 实际服务的 `/assets/order-show-app-CkfPeKZ8.js` 返回 HTTP 200，包含“提交变更审核”和“重新提交并恢复订单”。
- 从业务后端容器读取的 app.jar 包含逐商品减量判断及作废后恢复逻辑。
- 更新后只做只读检查，未创建或修改真实订单。完整业务流程已在隔离测试中验证；本次未做真实浏览器或手机操作验收。

已有浏览器页面需刷新或关闭后重新进入，以加载新前端资源。
