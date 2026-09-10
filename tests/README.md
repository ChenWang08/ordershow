# 测试分层与运行方式

## 测试分工

- `rendered-html.test.mjs`：运行构建后的服务端入口，检查实际 HTML 与必要资源。
- `admin-*.test.mjs`、`workspace-orders.test.mjs`、`h5-flow.test.mjs`、`screens.test.mjs`：验证业务计算、操作结果、组件渲染及部分状态行为。其中 Hook 操作测试使用显式状态适配器，不能代替真实 React 浏览器生命周期测试。
- `source-contracts.test.mjs`：保留的源码、迁移和接口文档约束检查。它们不是运行时覆盖率；本轮移除了一批已有行为测试覆盖的函数名和实现细节断言。后续需求优先增加行为测试，再按覆盖情况逐项替换剩余源码约束。
- `backend/src/test`：Java 单元、接口契约和隔离 API E2E。
- `scripts/browser-regression.mjs`：真实浏览器关键流程，包括活动切换、H5、管理员订单编辑、大屏筛选、趋势交互和响应式布局。

## 运行

本地前端检查使用 `npm test`、`npm run typecheck`、`npm run lint`。类型检查同时禁止无用局部变量和参数。`tsconfig.tsbuildinfo` 是可再生成的缓存，不应提交。

完整隔离检查使用 `scripts/run-automated-tests.ps1 -KeepEnvironment`，它创建专用测试栈并执行前后端测试。随后设置 `ORDER_SHOW_E2E=order-show-e2e`，运行 `node scripts/browser-regression.mjs`。Playwright 可安装在本机，或通过 `ORDER_SHOW_PLAYWRIGHT_MODULE` 指定已有的 `playwright/index.mjs` 文件 URL。

浏览器脚本只使用固定的 3100/8180 测试端口，并依赖 API E2E 生成的夹具。测试会创建和修改订单、截止测试活动，因此整套复跑前必须重新生成隔离数据。验证后使用 `scripts/test-env.ps1 reset` 清理测试环境。

当前结果和未覆盖范围见 `docs/testing/refactor-regression-2026-09-07.md`。通过测试不代表此前记录的客户名称标准化缺陷已被修复，也不代表压测、灾备和全部浏览器兼容性已验收。

## 性能测试

独立压测环境使用 `docker-compose.load.yml`，项目名 `order-show-load`，后端端口8280。
启动、生成数据、执行k6/SSE及清理方法见 [load/README.md](load/README.md)。
执行范围见[性能计划](../docs/testing/performance-test-plan.md)，本机实测与未验收项见[性能报告](../docs/testing/performance-test-report.md)。
性能测试不由 `npm test` 自动启动，避免常规回归意外产生高负载。
