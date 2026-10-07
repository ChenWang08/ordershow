# 前端模块边界与状态生命周期

## 页面入口

`app/order-show-app.tsx` 负责页面导航和统一组装，`app/activity-routes.tsx` 负责活动路由。`ActivityWorkspaceProvider` 在导航页面之外持有当前工作区状态；页面组件不得通过全局单例保存客户订单或导入数据。

| 模块 | 职责 |
| --- | --- |
| `features/workspace/useActivityRuntime` | 活动元数据、活动状态轮询、公共抽奖信息 |
| `features/workspace/useImportWorkspaceState` | 商品、白名单、到场三类导入工作区，分别保存行、状态与元信息 |
| `features/workspace/ActivityWorkspace` | 活动与导入上下文及其生命周期 |
| `features/workspace/SurfaceConnections` | 后台、H5、抽奖页面与共享状态的连接 |
| `features/workspace/useAdminWorkspaceProps` | 将共享工作区映射到后台模块所需字段；根页面不再传递大批参数 |

综合预览页需要保留 H5 挂载，切换页签时只隐藏它。后台导入结果仍按原规则供 H5 和抽奖读取，不能因组件拆分把共享数据改成互不关联的副本。独立路由只挂载对应页面。活动切换仍使用既有路由流程，进入新工作区时重新初始化；后台工作区 key 包含账号 ID、活动 ID 和排序后的权限集合；权限变化时重建工作区，避免继续显示已失去权限的旧模块数据。

## 后台组件

- 商品表格、图片处理与表单位于 `features/admin/products`。
- 白名单表格与表单位于 `features/admin/whitelist`。
- 到场页面、表格、表单及标签位于 `features/admin/attendance`。
- 通用删除确认位于 `features/admin/shared`。
- 已移除没有调用方的旧 `AdminComponents.tsx` 聚合出口，组件直接从所属业务目录导入。后台工作区入口为 `AdminWorkspace.tsx`，H5 入口为 `H5Ordering.tsx`。

## 成员账号与模块授权

- `AdminGateway` 处理统一登录和身份同步，识别三类角色；每 15 秒、重新聚焦及收到模块权限拒绝时刷新身份。
- `permissions.ts` 定义六项权限、导航和管理员判断；`AdminLayout` 只显示允许的模块，管理员始终可进入成员管理，即使本部门尚无活动。
- `MemberAdminPanel` 提供成员列表、新增、编辑权限、密码重置和启停。超级管理员可选择部门，部门管理员固定在本部门。
- `useAdminInitialization` 只加载已授权模块明细；`useModuleContext` 获取不含个人明细的客户/到场计数、类型模式和发布状态，支持模块独立使用。
- `ActivityOverview` 对成员禁用配置字段并隐藏发布、撤回、截止、结束等管理员专属按钮；成员也没有新建活动入口。
- 零权限成员不加载业务模块并显示联系部门管理员提示。后端是最终安全边界，前端隐藏不能代替接口权限检查。
- 订单编辑通过 ORDER 专用客户/商品查询加载必要选项，不依赖 PRODUCT 或 WHITELIST 权限。新历史记录展示实际账号身份快照。

## 订单管理

`components/orders/OrderManagement.tsx` 只组织以下模块：

- `useOrderList`：筛选、分页、加载、详情获取及导出。
- `useOrderEditor`：客户与商品选择、试算、创建、调整和作废操作。
- `order-domain`：接口数据到展示记录的转换、格式化及估价函数。
- `OrderFilterBar`、`OrderListTable`、`OrderDetailDrawer`、`OrderEditorDrawer`：对应界面。

编辑器与列表通过明确的状态更新函数协作。修改数量后必须清除旧试算结果；保存必须携带当前版本及锁版本。抽屉保留在订单管理组件的生命周期内，不因内部展示区域切换而重置。

回归入口为 `npm test`、`npm run typecheck`、`npm run lint` 和隔离环境的 `scripts/browser-regression.mjs`。成员新增行为测试见 `tests/member-navigation.test.mjs`、`tests/admin-shell.test.mjs` 和 `tests/admin-activity.test.mjs`，专项 API 验收见 `scripts/test-department-members.mjs`；成员功能尚未完成真实浏览器验收。原浏览器回归包含活动切换、订单搜索、历史版本展开、管理员调整和 H5 查看新版本。
