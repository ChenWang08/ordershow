# 2026-09-29 抽奖金额加权

## 变更

- 每轮抽奖新增 `EQUAL` / `ORDER_AMOUNT_WEIGHTED` 概率模式；新建轮次默认金额加权，历史轮次迁移后保持等概率。
- 金额加权直接使用开奖时当前 `SUBMITTED` 订单的 `customer_order.total_amount`，不生成实体奖券。
- 管理端候选预览显示理论概率并保留两位小数；现场抽奖大屏不展示概率。
- 新增 Flyway `V032__lottery_order_amount_weighting.sql`，在 `lottery_round` 增加 `probability_mode`。

## 验证

- 前端类型检查、构建、Lint 和 111 项自动化测试通过。
- 后端 Docker 构建通过；后端测试 133 项通过，21 项按环境条件跳过。
- 本地 Docker Compose 已重建 backend/frontend，Flyway 日志确认 32 个迁移全部通过并应用到 V032。
- MySQL、Redis、MinIO 数据卷未重建或清理。
