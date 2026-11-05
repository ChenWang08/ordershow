# 活动菜单与公共删除进度：定向验证

## 本轮实现

- 活动菜单取消“活动范围”筛选和菜单底部删除进度，只保留原部门筛选；默认显示服务端授权的全部活动，包括归档活动，权限范围不扩大。
- 草稿为中性灰、待开始为黄、订货中为绿、订货已截止为橙、活动已结束为中性灰。只有 FINISHED/ARCHIVED 在名称旁显示“未归档/已归档”，已归档标记为紫色，右侧业务状态均为“活动已结束”。其余四种状态不显示归档标记。
- 公共顶栏按钮顺序为“删除进度”“操作日志”，删除进度仅超级管理员可见；成员管理、部门与账号及业务模块共用入口。无活动、最后活动被删除、活动加载中或加载失败时仍能使用。没有增加侧边栏或新页面，原管理操作仍在活动设置底部。
- `AdminEntry` 在认证之后、活动工作区之外持有唯一 `ActivityDeletionProgressProvider`；正常顶栏与空/加载/失败顶栏的按钮打开同一抽屉，活动菜单不再消费删除后自动打开标记。
- 仅显示按钮不读取任务。抽屉打开且页面可见时读取当前页；本页有 QUEUED/RUNNING 时约3秒继续，COMPLETED/FAILED 停止。关闭、页面隐藏、换页、刷新或卸载取消旧请求和定时器，迟到结果不会写回；返回可见时重新读取，失败“继续清理”成功后恢复更新。关闭前端不取消服务器删除任务。
- 窄屏顶栏分行，长活动名可换行，菜单宽度受屏幕限制。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 相关行为回归 | 44项通过，0失败、0跳过；覆盖六状态与标记、部门筛选、全归档、生命周期权限与确认、订单只读、分页、隐藏/恢复、取消与迟到响应、失败继续及卸载停止 |
| 定向类型检查 | `tests/activity-lifecycle.tsconfig.json` 通过 |
| 修改的TS/TSX及测试脚本ESLint | 通过，无警告或错误 |
| Chrome真实浏览器 | 1440×960、440×960、320×960通过，三种宽度均无页面横向溢出，窄屏标题及操作区不重叠 |
| 公共入口 | 八个后台模块只有一个入口；页面静置不读取任务，打开后每次定时只增加一轮读取 |
| 异常与权限 | 使用真实 `AuthorizedWorkspace`/`EmptyAdminWorkspace` 验证加载中、加载失败、空活动及删除最后活动后自动打开；部门管理员和成员可见归档活动，无生命周期和删除进度入口 |
| 浏览器交互 | 归档/解除归档、三项删除确认、失败继续、任务完成及关闭停止读取均通过，无页面脚本错误 |

行为测试执行：

```powershell
node --test tests/activity-lifecycle.test.mjs tests/activity-info-http.test.mjs tests/activity-background.test.mjs tests/workspace-orders.test.mjs tests/order-review.test.mjs tests/admin-module-loading.test.mjs tests/department-isolation.test.mjs tests/member-navigation.test.mjs
```

类型与代码检查：

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tests/activity-lifecycle.tsconfig.json
node node_modules/eslint/bin/eslint.js app/features/admin/ActivitySwitcher.tsx app/features/admin/useAdminActivities.ts app/features/admin/ActivityDeletionProgress.tsx app/features/admin/ActivityDeletionTasks.tsx app/features/admin/AdminEntry.tsx app/features/admin/AdminHeader.tsx app/features/admin/AdminLayout.tsx tests/activity-lifecycle.test.mjs tests/department-isolation.test.mjs tests/member-navigation.test.mjs scripts/test-activity-lifecycle-browser.mjs
```

浏览器执行：

```powershell
$env:ORDER_SHOW_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/test-activity-lifecycle-browser.mjs
```

脚本在4197端口运行临时测试夹具，用真实菜单、顶栏、公共进度、管理操作及空/异常入口组件，接口全部由合成HTTP替代；业务模块内容不执行整站端到端验收。启用React StrictMode验证挂载/卸载，开发模式初次被取消的读取不代表存在两份轮询。截图和请求记录输出到忽略目录 `outputs/activity-lifecycle-browser/`，报告为 `report.json`；结束后自动关闭浏览器与测试服务。

本机受限执行首次类型/规范检查异常耗时，停止本次两项检查进程后使用相同检查入口重新执行，均正常通过。

## 边界

- 仅验证本次相关前端模块；未运行整站构建、整体回归或生产压测。
- 未构建或部署业务镜像，未启动业务应用，未访问业务数据库。本轮前端沿用现有接口，无新增迁移。
- 此前删除阶段31外键修复及其16项数据库/文件验证独立记录于[删除引用修复](activity-deletion-import-reference-2026-11-04.md)，本轮未重新启动该数据库测试。
- 首次生命周期实现及历史测试保留在[2026-11-03记录](activity-lifecycle-2026-11-03.md)；当前菜单交互以本文及PROJECT为准。
