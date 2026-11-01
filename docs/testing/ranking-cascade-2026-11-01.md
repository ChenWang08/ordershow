# 订货排行联动与空值修正（2026-11-01）

## 本轮范围

仅实现确认的两项：筛选器联动、未填写/空值统一。保留客户类型/大区/项目组单选、品种多选，以及金额和吨数排行。没有新增数据库迁移、实时品种汇总或下单写入；没有部署业务 Docker、迁移业务库、发布镜像或推送。

此前按需查询与负载结果保留在[原报告](ranking-on-demand-2026-10-31.md)。本报告描述后续联动修正，不用此前性能数据代表本轮新选项 SQL 的耗时。

## 联动规则

1. 客户类型改变，重置大区、项目组、品种；大区改变，重置项目组、品种；项目组改变，重置品种。
2. 客户类型 → 大区 → 项目组 → 品种逐级收窄。项目组“全部”展示当前客户/大区范围的全部品种。
3. 选项来源为当前发布配置和有效订单实际维度。目录配置必须对所选范围内至少一个有效白名单客户适用，遵守商品客户类型、分公司范围和经销商名单。大区只筛客户，不新增商品与大区的配置关系。
4. 包含适用但尚未下单的品种；无匹配订单时金额/吨数总计为 0，排行列表为空，不虚构客户排行。当前目录变化不替换订单中保存的商品身份快照。
5. 进入页面、编辑条件只读取选项，不读取排行；确认才统计。手动刷新沿用最后一次成功确认的条件和指标，失败保留旧结果及成功时间。
6. 客户类型/大区变化时读取上游范围选项；项目组变化在已返回的项目组/品种对中筛选，无需再请求。加载中禁止确认；快速切换取消旧请求，迟到响应不覆盖新范围。失败支持重试。

`GET /ranking/options` 新增 `customerType`、`regionCode`、`regionUnassigned` 参数；`customers` 保持完整维度供大区本地联动，`products` 按客户/大区范围返回。未指定或 `customerType=ALL` 仍表示全部客户，包含数据库类型为 `ALL` 的不区分类型客户。

## 空值原因与修正

- 应用全局 Jackson `NON_NULL` 会省略 `regionCode:null` 等字段；原前端只检查严格等于 null，把省略的字段变成 `value:undefined`，再向查询发送字面值 `undefined`，因此筛不出未填写订单。
- 后端选项和历史快照已经对大区执行 `NULLIF(TRIM(...),'')`，原实时查询只判断 null/空字符串，遗漏纯空格大区，导致实时与历史结果不同。
- 修正后，选项响应显式返回 `regionCode`、`productLine`、`varietyName` 的 null 字段；前端兼容字段缺失、null、空串和纯空格，统一发送 `regionUnassigned`、`productLineUnassigned`、`includeUnspecifiedVariety` 专用标记。
- 选项提取、客户/大区查询及新冻结基础使用相同的 SQL 空格规范化。不批量改写原订单。普通实际名称 `未填写`、`全部` 不作为标记，前端增加维度名称后缀以区分同名选项；名称中的逗号仍完整保留。

## 历史边界

新历史快照在原 `activity_ranking_snapshot.options_json` 内增加客户类型/大区/项目组/品种关联资料，不新增表。FINISHED 随正式订单维护更新，ARCHIVED 冻结后从保存的关联资料联动，不读取当前目录替换历史。

旧冻结快照若没有关联资料，全部客户＋全部大区仍可读原选项；限定客户/大区返回 `409 RANKING_OPTIONS_SCOPE_UNAVAILABLE`，不猜测历史适用范围，也不重写归档。原 `RANKING_HISTORY_MISMATCH` 核对规则保留，用户已同意暂缓旧历史兼容/核对修复。

另一台电脑“酱油＋具体品种查不到”的数据问题按用户要求暂缓，不将本轮测试通过表述为已修复该远程活动。

## 验证

排行前端专项 63 项通过；后端本轮 17 项全部通过，无跳过。全量前端回归共 376 项，364 通过、12 失败；12 项均因工作区另一路手机端改动删除了 `H5OrderRefresh.tsx`、而 `source-contracts.test.mjs` 仍引用该文件而报 ENOENT。该文件与相关手机端改动不属于本轮排行范围，未恢复或改写；全量结果不宣称通过。明细保存在本地忽略目录 `outputs/ranking-cascade-full-frontend.log`，排行专项见 `outputs/ranking-cascade-frontend.log`。

- 前端构建、TypeScript 检查和本轮文件 ESLint 检查通过。
- `ranking-filters.test.mjs`：联动、重置、字段缺失/null/空串/空格、实际同名选项和上游参数。
- `screens-manual-refresh.test.mjs`：迟到响应取消、范围加载失败/重试、确认阻止、编辑不统计、旧结果保留、最后成功条件刷新与活动隔离。
- `scripts/test-ranking-filters-browser.mjs`：真实 React、项目样式和合成 HTTP，验证上下游联动、参数、空值、请求失败/恢复、金额/吨数、静置不查询；1920/1440/768/440 宽度下下拉框不越界、不被榜单遮挡，无页面异常。截图保存在本地忽略目录 `outputs/ranking-filters/`。
- `PageStatisticsControllerTest`：真实 MVC 参数绑定，以及全局 NON_NULL 配置下 null 选项键仍存在。
- `RankingFiltersIntegrationTest`：专用 MySQL 中实际 SQL 的客户/大区/商品交集，适用但未下单配置、分公司/经销商范围，空格与 null 在实时/新历史一致，新归档不随目录修改，旧冻结选项不猜测关联、不改写原值。
- `RankingMigrationIntegrationTest`：固定 V043 → V044，检查原订单/明细不变、各类客户保留大区及结束更新/归档冻结。原测试未限定升级目标，会被后续 V047/V048 新增价格列干扰；本轮将专测目标明确为 V044，生产迁移文件没有改动。

后端测试使用固定 `order-show-e2e` 项目的测试端口 33306 和临时库，不接受业务数据库地址。测试结束清理该测试栈；不启动业务端口 3000/8080。

### 复跑

```powershell
node node_modules/vinext/dist/cli.js build
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test tests/ranking-filters.test.mjs tests/screens-manual-refresh.test.mjs tests/screens.test.mjs
node scripts/test-ranking-filters-browser.mjs
docker compose --project-name order-show-e2e --file docker-compose.test.yml up -d --wait mysql-test redis-test minio-test
docker run --rm -e ORDER_SHOW_RANKING_FILTER_TEST=order-show-e2e `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml `
  '-Dtest=RankingFilterTest,RankingFiltersIntegrationTest,PageStatisticsControllerTest,RankingMigrationIntegrationTest' test
docker compose --project-name order-show-e2e --file docker-compose.test.yml down --volumes --remove-orphans
```

浏览器脚本支持 `ORDER_SHOW_PLAYWRIGHT_MODULE` 和 `ORDER_SHOW_BROWSER_PATH` 指定本机 Playwright 与浏览器。Maven 离线运行依赖已准备的测试缓存；无缓存时先按既有测试流程准备依赖。

## 资源影响

联动选项仍需读取实际有效明细维度，客户类型/大区变化会增加一次按范围的选项读取；项目组与品种变化在前端处理。选项查询不计算金额、吨数或排名，也不触发新的汇总维护。历史 JSON 增加去重关联资料，结束冻结/结束后维护时存在对应读取与保存成本；不增加进行中下单的写入成本。本轮未重复直播混合负载压测，不承诺新选项请求的固定耗时。
