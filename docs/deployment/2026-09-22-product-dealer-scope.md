# 商品分公司与经销商下单范围部署（2026-09-22）

本次将商品下单范围功能部署到本机 `order-show` 业务环境。

## 已部署内容

- backend：新增商品分公司与经销商范围接口、后端下单校验、范围继承和修改日志；
- frontend：商品编辑抽屉加宽至约 1100px，分公司与经销商范围上下布局；分公司支持搜索和多列展示，经销商按当前分公司搜索、复选和全选状态维护；
- 数据库：Flyway 执行 `V030__product_dealer_scope.sql` 和 `V031__reconcile_product_dealer_scope_branch_changes.sql`；
- 商品列表：显示分公司范围内的有效经销商数量，指定名单失效时显示待处理；
- 活动开始后的范围修改：要求原因并写入范围修改日志。

## 环境操作

- 仅重建并替换 `order-show` 的 backend、frontend 容器；
- MySQL、Redis、MinIO 容器和数据卷保持不变；
- V030、V031 迁移记录为成功；V031 清理了分公司范围发生变化时的历史指定名单残留；
- backend 健康检查和 frontend HTTP 检查均通过。

## 验证

- `pnpm typecheck` 通过；
- `pnpm lint` 通过；
- 商品范围选择器专项测试通过；
- 后端范围、继承、活动隔离和修改原因测试通过。
