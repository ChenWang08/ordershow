# 活动归档与永久删除：实现及定向验证

日期：2026-11-03。范围：本次涉及的活动、订单只读、权限、文件和删除任务模块；未部署业务应用，未修改业务数据库。

## 使用规则与入口

- 复用后台顶部活动切换菜单，提供“未归档 / 已归档 / 全部”筛选、归档标记及超级管理员可用的“删除进度”，不新增侧边栏。删除最后一场活动后仍能进入进度。
- 活动概览的“活动设置”底部显示归档、解除归档、永久删除操作，只有超级管理员可操作；后端同时验证权限。
- 仅已结束活动可手动归档。归档保留数据，按原部门范围和功能权限查看及导出，业务数据禁止修改。解除归档恢复为已结束，不自动开放订货。
- 允许永久删除草稿、已结束和已归档活动。进行中的活动须先撤回或结束；待审批改单及未完成的导入、导出须先处理。
- 删除前展示活动和关联数量，要求填写原因、输入准确活动编号并确认不可恢复。不自动备份，无回收站。
- 删除请求受理后立即从列表隐藏，后续活动、订单、文件等请求被拒绝。后台逐批清理，失败可继续，保留独立删除任务凭证。

## 后端实现

- V051 新增活动删除标记、文件活动索引、独立删除任务、文件清理清单及跨实例协调记录；同步维护 schema、接口文档与状态机。
- 读取检查在 HTTP 缓存/ETag 前执行，避免删除后旧缓存返回活动资料或文件。H5 缓存会话也重新核对活动是否可访问。
- 管理端写入取得活动排他锁，H5 写入取得共享锁，归档及删除与在途写入协调。归档前生成最终看板和排行快照。
- 草稿保存保留原有独立事务与重试；导入保留上传、解析和失败记录的事务边界。这两条流程在服务自己的首个事务内取得活动锁，避免外层事务破坏重试或回滚失败留痕。
- 后台删除使用独立单线程执行器，不占用活动时钟及实时事件的调度线程。跨实例通过数据库协调锁限制同时处理的批次。
- 默认每批最多500行，可配置1～1000行；批间默认至少500ms，单条清理 SQL 超时10秒。每个文件批次只删除一个原文件及对应缩略图、展示版本。
- 清理阶段、游标、实际行数和文件数随事务提交，重启后从已提交位置继续。默认最多自动重试5次，之后由超级管理员手动继续；不会恢复已清理的数据。
- 保持外键检查开启，先清子记录，最后清文件元数据和活动本身。跨活动共享文件先暂停清理，避免误删仍在使用的对象。
- 清理覆盖订单明细及历史、改单、抽奖、商品及范围、白名单、到场、导入导出、文件、快照、审计、幂等记录和事件等关联数据。全局客户主档及管理员账号保留。

## 已执行的前端检查

| 检查 | 结果与范围 |
| --- | --- |
| 前端相关回归 | 62项通过，含新增9项归档及删除行为测试，以及活动 HTTP、背景、订单、审核、模块加载、抽奖相关兼容回归 |
| 定向类型检查 | 活动管理入口、工作区及其引用通过 |
| 修改文件 ESLint | 相关组件、测试和浏览器验证脚本通过 |
| 真实 Chrome | 1440px及440px通过，使用实际组件、样式和模拟 HTTP |
| 浏览器交互 | 归档筛选、归档/解除、三项删除确认、受理后自动展示进度、空活动进度入口、失败继续通过 |
| 请求行为 | 进度仅打开且页面可见时约3秒检查；关闭、隐藏或当前页任务全部结束后停止；部门管理员没有生命周期操作和删除任务入口 |
| 接口文档 | OpenAPI YAML成功解析，共96个路径；新增6个接口及对应数据结构 |

浏览器证据位于忽略目录 `outputs/activity-lifecycle-browser/`：`report.json` 与桌面、窄屏菜单/确认框/进度截图。已检查窄屏菜单和删除确认布局。

前端复跑：

```powershell
node --test tests/activity-lifecycle.test.mjs tests/activity-info-http.test.mjs tests/activity-background.test.mjs tests/lottery-settings.test.mjs tests/lottery-board.test.mjs tests/workspace-orders.test.mjs tests/order-review.test.mjs tests/admin-module-loading.test.mjs
npm run typecheck:activity-lifecycle
$env:ORDER_SHOW_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/test-activity-lifecycle-browser.mjs
```

`npm run test:activity-lifecycle` 是日常活动及订单专项入口；上面的62项额外包含本次执行的抽奖兼容检查。浏览器脚本复用已有 Playwright，测试页端口4197，结束自动关闭测试页服务和浏览器，不连接业务 API。

## 真实 MySQL 验证范围

最终通过的后端相关用例共122项，按本轮不同测试类和方法去重：数据库生命周期12项，其他23个相关测试类110项；未把环境条件跳过的测试计入通过数。

数据库专项前11项在整组运行中通过；新增第12项兼容用例的测试数据最初缺少独立白名单发布版本，补齐后单独复测通过。最后一次运行只选择该方法，结果为1项通过、0失败、0错误、0跳过，其余11项没有重复执行。对象清理测试曾有Mockito异常类型夹具问题，也已修正并复测通过。

其他相关回归包括活动读取、汇总、状态变化、重开、直播间、背景、路由、部门与成员权限、会话缓存、订单价格、草稿事务、手机号验证、导入筛选/到场预览、审计、私有文件、图片版本和抽奖排序。最终报告保存在忽略目录 `outputs/activity-lifecycle-backend/final-reports/`，汇总为 `final-report-summary.json`；`before-whitelist-fixture-fix/` 保留第12项夹具修正前的整组报告及其中11项的通过证据。

`ActivityLifecycleIntegrationTest` 固定连接端口33326的 `order_show_activity_lifecycle_test`，只有设置 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only` 才运行，不读取业务数据库地址。每次运行只重建这个临时测试库，执行 V001～V051 全部51个迁移，不允许与同库测试并行。

12个用例覆盖：

1. 归档、最终快照、按原部门读取、跨部门拒绝、解除归档及版本冲突。
2. 删除状态限制、活动编号和版本校验、未处理改单阻断。
3. 1201条订单明细及对应商品，按每批100行清理；更换 worker 后继续，验证所有关联记录清空，另一活动逐表数量不变，客户主档及账号保留。
4. 文件服务故障后保留清单，失败重试继续，不恢复部分删除数据。
5. 删除后异步审计不重新引用活动。
6. 对照数据库全部 activity_id 表，检查包含无外键关系的清理范围。
7. 归档与删除管理接口仅超级管理员可用。
8. 真实 MVC 在公开、H5、管理、大屏和文件的条件缓存请求前拦截已删除活动。
9. 真实并发事务中删除等待既有写入完成，多实例协调锁阻止重复批次。
10. 文件仍被另一活动引用时暂停，解除引用后重试完成。
11. 实际 Spring 代理生效，拒绝归档/删除后的业务写入，业务异常回滚。
12. 草稿保存通过代理仍可使用独立事务；归档后拒绝保存；导入解析失败后 FAILED 任务仍提交并可正常清理。

`StorageDeletionTest` 使用对象服务替身验证原图、两类衍生版本、长文件名键、重复清理及异常向上抛出；没有连接真实对象存储。

临时 MySQL 使用 `mysql:8.4`、1GB内存/1.5CPU、内存文件系统，不挂载业务数据卷。Maven 使用 `maven:3.9.11-eclipse-temurin-21` 和已有依赖缓存；仅编译并执行测试，没有构建业务镜像。

复跑时先创建专用临时库；以下密码仅供这套合成测试使用：

```powershell
docker run -d --rm --name order-show-activity-lifecycle-test-mysql `
  --tmpfs /var/lib/mysql --memory 1g --cpus 1.5 `
  -p 127.0.0.1:33326:3306 -e MYSQL_ROOT_PASSWORD=activity_test_only `
  -e MYSQL_DATABASE=order_show_activity_lifecycle_test mysql:8.4
docker exec order-show-activity-lifecycle-test-mysql mysqladmin ping -uroot -pactivity_test_only
```

确认返回 `mysqld is alive` 后运行专项：

```powershell
docker run --rm -e ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml `
  '-Dtest=ActivityLifecycleIntegrationTest,StorageDeletionTest,DraftSaveTransactionsTest,H5PhoneVerificationServiceTest,AttendanceMatchPreviewTest,ImportTaskFilterTest' test
```

完成后执行 `docker stop order-show-activity-lifecycle-test-mysql`，`--rm` 和内存文件系统会随之清理本次测试库。

本轮已经停止该临时容器并销毁测试库；浏览器脚本也已关闭测试页服务和浏览器。

## 性能与发布边界

- 归档保留原表中的数据，不会直接减少数据库行数或磁盘占用。永久删除完成后才减少业务数据；数据库文件大小是否立即缩小由存储引擎决定。
- 这次验证了批次上限、事务提交续跑、故障恢复、锁协调、其他活动隔离和浏览器请求行为，没有进行生产规模压测，不能据此承诺整体性能提升比例。
- 浏览器 HTTP 和文件对象服务使用替身；没有验证生产网关、真实对象存储、持久磁盘负载或在线多人并发下单。
- 未执行全系统回归、本地业务部署、业务库迁移、业务服务重启或推送。启用需要配套发布前后端及应用 V051；当前部署版本不会因源码修改自动更新。
