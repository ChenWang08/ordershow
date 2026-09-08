# 大屏组件与样式边界

## 页面和图表

`ScreenBoards.tsx` 保留三个公开页面的兼容导出，页面实现分别位于 `OrderDashboard.tsx`、`RankingBoard.tsx` 和 `ReportBoard.tsx`。

- `useOrderDashboard`：订单看板远端加载、手动刷新、15 秒轮询及 SSE；历史模式不建立轮询和 SSE。
- `dashboard-domain`：数值显示、时间桶、趋势补零、曲线路径、产线颜色和看板展示数据计算。
- `DashboardCharts`：条形图和榜单。
- `DashboardTrendChart`：趋势显示、点位详情和横向拖动，独立持有交互状态。
- `ReportMetricTable`：战报数据表。

排行和战报保留各自的请求、错误处理和订阅生命周期，未强行合并成通用加载器。趋势组件持续挂载在原位置，刷新数据时不会因组件拆分主动重置选择或拖动状态。

## 样式组织

`app/globals.css` 现在是统一导入入口，仍在根布局中一次性加载。导入顺序不能随意调整：

1. Tailwind 与 `styles/foundation.css`：基础变量、页面入口及共享节日装饰。
2. `features/h5/h5.css`：H5。
3. `features/screens/styles/boards.css`：排行与战报。
4. `features/lottery/lottery.css`：抽奖。
5. `features/admin/styles/admin.css`：后台。
6. `styles/shared-details.css`：原文件后段的数字对齐及共享细节覆盖。
7. `features/screens/styles/dashboard.css`：订单看板。
8. `styles/responsive.css`：跨模块响应式规则，保留在最后。

混合响应式规则仍集中保存，避免迁移时改变覆盖顺序。原有选择器、声明值、媒体查询及绝对资源 URL 均保持；没有引入 CSS Modules 或更改类名。

迁移时递归展开本地 CSS 导入，并使用 PostCSS 对比忽略注释和排版后的有序语法树。1,330 条规则对应的选择器、声明、媒体查询和顺序完全一致。此次比较用于验证迁移等价性，不要求后续正常样式修改继续符合旧文件快照。
