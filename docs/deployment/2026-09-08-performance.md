# 本地性能优化版本更新

时间：2026-09-08 10:40～10:41（Asia/Shanghai）。用户确认当前为本地开发环境，授权直接替换前后端。

已构建当前工作区并替换order-show项目的frontend、backend容器，使用`up -d --no-deps --no-build`，后端健康后再替换前端。
MySQL、Redis和MinIO容器未重建，数据卷保留，没有执行数据清理。Flyway验证24个迁移，数据库仍为024，无新迁移。

| 应用 | 新镜像ID |
|---|---|
| frontend | sha256:c8cd6b728583cba8391cb51f268784aaf72e91570d178de9afa4c0064357fc41 |
| backend | sha256:005a99a99ac56b2cbba8a9d18e9179c75f6e0f3c96957c255d27ae1135e863c9 |

旧镜像保留为order-show-frontend:pre-perf-20260908、order-show-backend:pre-perf-20260908，可供本地回退；未实际执行回退。这是镜像保留，不是数据库备份。

## 更新后检查

- 后端健康检查UP。
- /admin、/h5、/h5/HD20260907004、/screen/HD20260907004/dashboard均HTTP 200。
- 当前活动查询与对应看板API成功。
- MySQL、Redis、MinIO容器ID分别仍为a33a295f6567、a71d84dae504、7f988690f6d9。
- customer_order 383、order_version 393、activity_product 892、activity_customer 4776、stored_file 622，更新前后数量一致。这不是逐行数据比对。
- 浏览器运行时未发现可连接实例，未执行交互/视觉验收；检查采用只读页面及API请求，没有在业务库新建测试订单。

此前隔离环境已完成的功能回归和性能对比见[优化报告](../testing/performance-optimization-report.md)。本次部署不等于新增千人峰值或长稳验收。

本地入口：http://localhost:3000/admin 。已打开的页面建议强制刷新以加载新前端资源。
