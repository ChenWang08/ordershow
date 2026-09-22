# 本机 H5 幂等重试更新（2026-09-21）

按顺序构建并更新本机 order-show 的 backend、frontend。使用现有 api_idempotency 字段及唯一约束，本次没有新增数据库迁移。

| 服务 | 容器 | 镜像 |
|---|---|---|
| backend | 83ae97979266 | sha256:24abd90abddb720ebbd38d05026e0866582a94068905e8f94818067941a4b380 |
| frontend | 1bf4ab5c633f | sha256:d6c4a6136e059dd168a4eb004ff3ffc2defd1f80d4ad119fed9f01db6e37c87b |

更新后 backend 健康检查 UP；http://localhost:3000/h5 和 /admin 均 HTTP 200。H5 PUT 跨域预检 HTTP 200，允许 X-H5-Customer-Id，并暴露 Retry-After。MySQL、Redis、MinIO 保持更新前的容器 ID。业务环境检查只读取健康、页面和预检，没有提交测试订单。

完整隔离回归：前端 103 项通过；后端 124 项中 119 项通过、5 项按 ORDER_SHOW_LOAD 环境条件跳过，包括 10 项 API E2E、2 项新 MySQL 幂等持久化/清理测试。随后补充的客户绑定控制器测试及 OpenAPI 契约共 2 项通过，最终 typecheck、lint 和前后端镜像构建通过。最后增加了前端请求绑定活动/客户的针对性校验，结果见实现说明。

成功快照使用 JSON 字符串保留金额精度；同键重放不会删除后来保存的新草稿，也不重复成功请求审计。旧格式成功键缺少快照时返回 IDEMPOTENCY_RESULT_UNAVAILABLE，要求核对订单。客户端刷新恢复仍须验证同一客户，详见 [实现及限制](../testing/h5-idempotency-retry.md)。

旧容器引用的镜像已经不在 Docker 可标记镜像集合中，未能创建旧镜像回退标签。上一源码提交为 aca1924，可据其重新构建旧版本；本次未演练回退。没有执行本轮容量压测或手机浏览器视觉验收。
