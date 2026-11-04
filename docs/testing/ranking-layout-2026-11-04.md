# 订货排行四层布局与一屏适配（2026-11-04）

## 修改范围

仅调整订货排行前端组件及相关样式：

1. 第一行居中显示金额排行、吨数排行切换。
2. 第二行显示客户类型、大区、项目组、品种、确认查询、重置和手动刷新；刷新按钮紧跟重置，最近刷新时间沿用原小字样式并排显示。
3. 第三行左侧显示订单金额，右侧显示订货吨数。
4. 剩余高度用于三列客户排行及右侧分公司榜。90名仍按1–30、31–60、61–90分列。

删除大标题、“历史回看”和“当前结果”摘要及其占位。保留待确认、加载失败及选项失效等必要提示。所有现有字体大小保持不变，沿用字体和字重，通过顶部间距、榜单标题留白及行间空间适配高度。行高最低19px，容纳原有分公司12px文字及边框；少量结果保留紧凑行高。高度不足时使用页面滚动，分公司超过30条时保留榜内滚动。

沿用现有进入页只读选项、确认后查询、手动刷新使用最后成功条件、重置等待确认、失败保留旧结果和刷新时间的行为。历史状态只移除显示文案，数据读取规则保持原有实现。

无后端代码、接口参数、数据库或统计排序逻辑改动；未构建或部署本地镜像，未操作业务服务。

## 定向验证

- 排行相关组件和手动刷新测试22项通过；筛选联动测试4项通过，共26项。
- 排行组件及其依赖的定向TypeScript检查通过；修改的TSX和测试脚本ESLint检查通过。
- 浏览器使用真实React组件、实际项目样式和真实可折叠顶部栏，HTTP全部为合成数据，不连接业务API或数据库。
- 在1920×1080、2560×1440、1366×768下分别检查金额/吨数两种排行。90条客户、30条分公司数据全部位于可见区域，无横向或纵向溢出；第30、60、90名完整显示。
- 对排行切换、筛选标签/控件、查询按钮、汇总数字/单位、榜单标题/单位、客户/分公司名称与数值、刷新时间共14类元素检查原字号；客户字体及字重检查通过。
- 1920×1080下展开顶部栏后仍完整显示90条客户和30条分公司数据。
- 验证ACTIVE/FINISHED/ARCHIVED、未查询、空结果、少量结果、60条分公司滚动及1366×420高度不足时的滚动访问。
- 验证客户/大区/项目组/品种联动、查询、重置、刷新沿用旧条件、失败保留结果和时间、选项失败重试、迟到请求取消、进入和空闲不统计。
- 1920/1440/768/440宽度下品种弹层不横向越界、不被榜单遮挡。无浏览器页面异常。

未运行全量回归、后端测试、业务数据库测试或整站构建。本次结果限定于上述前端组件及合成接口验证。

## 复跑与证据

```powershell
node --test --test-name-pattern=ranking tests/screens-manual-refresh.test.mjs tests/screens.test.mjs
node --test tests/ranking-filters.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tests/ranking-layout.tsconfig.json
node node_modules/eslint/bin/eslint.js app/features/screens/RankingBoard.tsx scripts/test-ranking-filters-browser.mjs tests/screens-manual-refresh.test.mjs
node scripts/test-ranking-filters-browser.mjs
```

浏览器脚本沿用本机测试依赖，可通过`ORDER_SHOW_PLAYWRIGHT_MODULE`和`ORDER_SHOW_BROWSER_PATH`指定其他已安装路径。只启动4181端口临时测试页，完成后关闭浏览器及测试服务。

截图及尺寸、字号测量保存在本地忽略目录`outputs/ranking-filters/`，包括`layout-1920x1080-AMOUNT.png`、`layout-1366x768-AMOUNT.png`及`layout-measurements.json`。截图使用模拟客户及默认节日背景，实际活动继续使用其既有背景配置。
