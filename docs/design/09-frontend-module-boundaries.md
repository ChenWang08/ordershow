# 前端模块边界与状态生命周期

## 页面入口

`app/order-show-app.tsx` 负责页面导航和统一组装，`app/activity-routes.tsx` 负责活动路由。`ActivityWorkspaceProvider` 在导航页面之外持有当前工作区状态；页面组件不得通过全局单例保存客户订单或导入数据。

| 模块 | 职责 |
| --- | --- |
| `features/workspace/useActivityRuntime` | 活动元数据与独立公共活动 SSE；后台按需更新，不加载抽奖资料 |
| `features/workspace/useImportWorkspaceState` | 商品、白名单、到场三类导入工作区，分别保存行、状态与元信息 |
| `features/workspace/ActivityWorkspace` | 活动与导入上下文及其生命周期 |
| `features/workspace/SurfaceConnections` | 后台、H5、抽奖页面与共享状态的连接 |
| `features/workspace/useAdminWorkspaceProps` | 将共享工作区映射到后台模块所需字段；根页面不再传递大批参数 |

综合预览页需要保留 H5 挂载，切换页签时只隐藏它。后台导入结果仍按原规则供 H5 和抽奖读取，不能因组件拆分把共享数据改成互不关联的副本。独立路由只挂载对应页面。活动切换仍使用既有路由流程，进入新工作区时重新初始化；后台工作区 key 包含账号 ID、活动 ID 和排序后的权限集合；权限变化时重建工作区，避免继续显示已失去权限的旧模块数据。

## H5 草稿与抽奖读取

| 模块 | 职责 |
| --- | --- |
| `features/h5/h5-local-draft` | 本机存储、格式/过期校验、活动/客户隔离、订单/申请基准；不发送 HTTP |
| `features/h5/useH5Draft` | 内存快照、800ms 本机保存、隐藏/卸载补存、恢复与失效提示；存储失败保留本页内存 |
| `features/h5/useH5OrderFlow` | 身份与购物车流程，先取得最新订单/申请再恢复本机草稿，确认成功后清理；不调用旧 `order-draft` |
| `features/h5/useH5OrderSync` | 订单/申请按需读取、15 秒普通刷新冷却、在途合并及操作前强制核对 |
| `features/h5/h5-submission` | 正式提交幂等与结果恢复，仍使用独立的 `sessionStorage` 命令记录，与本机购物车分开 |
| `features/lottery/Lottery` | 抽奖页面自己加载轮次和已保存结果，公共活动/H5 不预加载 |

本机存储实例属于当前 H5 组件，不用全局客户单例。恢复只发生在验证身份并核对当前订单/申请后，编辑中不响应其他标签页存储变化去替换购物车。待审核申请可继续编辑并保存本机草稿。关闭/隐藏不再补发草稿 HTTP，最终确认直接调用正式订单或变更申请接口。旧后台接口仅兼容旧客户端，不迁移旧草稿。

## 后台组件

### 进入加载与编辑保护（2026-11-04）

- `useLazyAdminQuery` 在首次启用、再次启用及显式 `entryKey` 变化时读取；商品、白名单、到场名单使用 `entry` 策略，关闭编辑不重读，成功局部更新后由 `acceptLocal` 确认当前快照；普通重渲染不查询，不设置周期轮询。隐藏、切换活动或开始编辑时取消在途请求，迟到结果不得提交。
- `useAdminInitialization` 仍按权限与当前模块读取整模块数据；`useModuleContext` 以当前模块名作为进入标识，商品直接切换白名单也重新读取公共计数。活动元数据每次导航同步，初次复用入口已取得的详情，未保存表单值不被覆盖。
- 同一活动内保留筛选、分页、未保存编辑和导入预览；有编辑/预览的模块暂停替换，商品、白名单、到场名单保存后局部更新，取消或关闭不触发整表读取；整批导入完成后读取一次正式清单，失败时清除失效编号并通过 `markRefreshError` 保留重试提示。导入任务隐藏时暂停进度查询，服务器已经启动的任务不因离开页面取消。
- 概览统计使用显式 `useAdminQuery`，仅“刷新统计”触发；首次进入、切回概览和活动设置更新均不查询统计。查询会话按活动和权限持有，不随模块切换自动启动；同一活动内保留上次手动快照，切换活动/整页刷新后等待手动查询。订单列表、审核页仍首次及返回均加载；保留“刷新统计”“刷新订单”“刷新审核”；商品、白名单、到场名单另提供“刷新列表”，编辑或预览期间禁用。失败保留最后快照并允许重试；保存结果不确定时保留原有核对/恢复入口。
- 抽奖保留整份规则配置接口，不拆轮次列表/详情。进入自动读取配置、公共计数和中奖统计，有效下单范围按需读取商品选项；候选计算仍由 `useAdminQuery` 的显式“手动试算”触发，针对当前轮，进入/切轮/编辑/保存不触发试算。
- 切换活动或整页刷新/关闭不注册未保存离开确认，未保存的本地状态随工作区销毁；发布、删除等业务确认及抽屉关闭保护不在此项移除范围内。

- `dealer-candidate-cache` 为当前活动及账号/权限范围持有60秒候选快照，合并并发读取，白名单写入/重读及卸载时清除；不写浏览器持久存储。`product-editor-images` 只提交图片实际差异，并通过局部状态接口合并受影响的同名商品。具体测试见[列表加载验证](../testing/admin-list-loading-2026-11-04.md)。

- 商品表格、图片处理与表单位于 `features/admin/products`。
- 白名单表格与表单位于 `features/admin/whitelist`。
- 到场页面、表格、表单及标签位于 `features/admin/attendance`。
- 通用删除确认位于 `features/admin/shared`。
- 已移除没有调用方的旧 `AdminComponents.tsx` 聚合出口，组件直接从所属业务目录导入。后台工作区入口为 `AdminWorkspace.tsx`，H5 入口为 `H5Ordering.tsx`。

## 成员账号与模块授权

- `AdminGateway` 处理统一登录和身份同步，识别三类角色；进入、重新聚焦及收到模块权限拒绝时按需检查身份，不进行 15 秒轮询。
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
