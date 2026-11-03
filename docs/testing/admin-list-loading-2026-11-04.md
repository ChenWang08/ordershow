# 后台商品、白名单、到场名单加载调整

## 范围与结果

- 三份列表首次进入、离开后再次进入和手动刷新时读取服务器；切回时保留已有内容，成功后更新。
- 正式数据的单条新增、编辑、删除使用服务器确认的结果更新本地列表。保存、取消或关闭抽屉不再触发整表读取，保留搜索、筛选和当前页（超出总页数时仍按表格原规则收敛）。
- 商品只改资料时不重复提交未修改的图片；范围变化读取当前商品状态；上传、删除、选择候选等图片操作读取受影响名称分组，更新所有受影响的同名商品，保留无关行。
- 增加后台商品 editor-state 读取接口；限制当前活动、当前商品版本、可见商品，复用商品权限和活动访问校验。未传名称分组时仅返回当前商品。名称中的逗号按原样处理。
- 商品经销商选择窗口的候选数据使用工作区内存缓存，60 秒到期，合并并发读取；白名单变更或重新读取后清除。按活动、账号及权限范围隔离，卸载时清除，不写 localStorage。
- 整批导入仍按原业务规则完整替换；确认发布完成后读取一次正式数据，取得新编号、版本及关联结果。读取失败时清空失效编号、结束预览、持续显示刷新提示，防止重复确认。
- 批量删除中途失败时，只移除服务器已确认删除的行，保留未确认记录并提示。
- 商品与白名单 Excel 仍在发布后锁定；活动进行中的单条新增/修改和审计规则保持现有行为。H5 商品读取、手机号验证及图片缩略图/503机制没有修改。

## 验证

| 检查 | 结果 |
| --- | --- |
| 相关前端行为测试 | 77/77 通过 |
| 浏览器合成 HTTP 测试 | 1440px、440px 均通过 |
| TypeScript | 通过 |
| 修改文件 ESLint | 通过，无警告 |
| 前端生产构建 | 通过 |
| 前端现有全量测试 | 411 项：401 通过、10 项原有失败 |
| 后端清理旧构建产物后全量测试 | 428 项：286 通过、142 按环境条件跳过，0 失败/错误 |
| 后端局部读取/图片/权限专项 | 24/24 通过，已包含在全量结果中 |

相关前端行为覆盖：进入与返回加载、关闭/取消/保存不整表读取、手动刷新合并、编辑保护、旧响应丢弃、账号键隔离、缓存到期/并发/失效/异常恢复、服务器编号与版本、导入确认及读回异常、部分删除失败、商品范围和同名图片更新、图片新增/删除/排序/主图/候选选择与排除、抽屉保存失败和重复提交保护。

浏览器使用真实 AdminEntry/工作区/三份列表/抽屉组件以及纯合成 HTTP 响应，验证保存与取消后请求次数不增加、分页和搜索保持、手动刷新、模块返回重读、候选缓存复用及白名单变化后失效。页面截图位于忽略目录 outputs/admin-list-loading/。

后端新增测试覆盖当前版本与活动边界、失效商品、单条读取、旧/新标准化名称分组、参数边界、真实 Spring MVC 查询参数绑定（包含逗号）、管理员及商品模块权限、范围摘要中的客户类型/分公司/无效成员、图片候选的当前版本过滤。未配置独立数据库，因此需要数据库或专门开关的集成/容量测试按原条件跳过；没有连接业务库。

## 原有前端失败

以下 10 项均在修改前 HEAD 的独立源码副本中复现（日志 outputs/admin-list-baseline-tests.log），未扩展本次业务修改范围：

- admin-activity.test.mjs：1 项文件级失败。
- admin-shell.test.mjs：3 项活动选择/账号创建测试失败。
- public-activity-snapshot.test.mjs：3 项公开脚本测试失败。
- source-contracts.test.mjs：3 项旧源码/路径约定失败（阶梯价格、抽奖调用形式、已移除的 OrderExportService.java）。

本次涉及的旧测试夹具已补足 React hooks、完整服务端返回和新增正式名单读取；源码约定扫描也包含了提取后的图片保存模块。没有将原有失败标成通过。

## 复跑

~~~powershell
npm run build
node --test tests/admin-list-cache.test.mjs tests/admin-product-images.test.mjs tests/admin-lazy-loading.test.mjs tests/admin-products.test.mjs tests/admin-customers.test.mjs tests/drawer-interactions.test.mjs
node --test tests/*.test.mjs
npm run typecheck

# 使用本机已有 Playwright 和浏览器；可按 scripts/test-admin-list-loading-browser.mjs 的环境变量指定路径。
node scripts/test-admin-list-loading-browser.mjs

docker run --rm --memory 1536m --cpus 2 -v order-show-m2:/root/.m2 -v "E:\fengyi\order_show:/workspace" -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml '-DargLine=-Xmx512m' test
~~~

后端首次全量运行发现 target 中残留已删除的旧导出测试 class；核对绝对路径后清理本项目 backend/target 并重新编译，以上结果以重编译后的当前源码为准。Maven 离线缓存缺少 clean 插件，因此未采用 mvn clean。原始日志位于 outputs/admin-list-backend-tests.log。

本次未构建或部署业务镜像，未启动完整业务服务，未修改 H5、生产/UAT 数据或任何真实订单。测试浏览器和临时测试前端服务器已退出。
