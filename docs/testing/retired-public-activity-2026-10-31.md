# 旧活动公开查询接口清理与回归验证

## 范围

本轮业务源码只删除两处遗留入口：

- `ActivityController.publicActivity()`，对应 `GET /api/v1/public/activities/{activityCode}`。
- 前端零调用的 `loadActivity()` 及仅供它使用的导入。

旧地址使用现有资源不存在处理，返回 `404 RESOURCE_NOT_FOUND`，不执行原活动资料读取。没有增加缓存、限流、兼容转发、停用开关或新环境变量，也没有新增数据库迁移。

以下入口与内部查询保留：

| 功能 | 保留行为 |
| --- | --- |
| 活动首次加载/公开资料更新/断线重连 | `/public/activities/{activityCode}/events` 的完整 `activity` 快照 |
| `/h5` 单活动兼容入口 | `/public/activities/current` |
| 手机号验证 | `/public/activities/{activityCode}/verify-phone` |
| 公开抽奖 | `/public/activities/{activityCode}/lottery` |
| 后台活动 | 原列表、详情、配置及状态操作接口 |
| 内部活动查询 | `ActivityService.byCode()`、`byId()`、`currentOrderable()` 及共用返回结构 |

商品缓存、活动 SSE 心跳/退避、后台按需读取、订单手动刷新和本机草稿规则保持原有实现。

## 测试与脚本同步

- `ActivityRoutesTest` 使用真实 MVC 路由、响应序列化及原资源不存在处理；验证已删除地址不调用活动服务，`/current`、SSE、手机号验证、抽奖和后台读取仍派发到原服务。
- `ActivityInfoIntegrationTest` 在完整 Spring Boot/Tomcat HTTP 栈追加旧路径 404 验证；保留真实 MySQL/Redis、两套订阅服务、事务回滚、截止/结束/重新开放、订单事件隔离及 Redis 恢复验证。
- 背景、浏览器流程、时间脚本与隔离 API E2E 的公开资料断言改读 SSE 首帧；没有改为仅检查后台响应。Node 共用辅助函数收到首帧后关闭连接，10 秒超时，失败不回退到旧 GET。Java E2E 同样有界等待并关闭响应流。
- `scripts/test-h5-entry.mjs` 委托现有手机号入口与活动 SSE 浏览器测试，替换旧通道选择流程及已不适用的 JSON 活动夹具。
- `capacity-scenario.js` 的 `full`/`journey` 移除旧活动 GET 及 `activity_ms` 指标，保留其他步骤及断言。测试执行真实场景函数确认成功链路仍完整。SSE 压力由独立场景评估；保留服务端草稿的负载入口仍属旧流程对照，本次没有改写为新 H5 完整负载模型。
- README、PROJECT、API 指南、OpenAPI 和测试说明同步。OpenAPI 补充原本漏记、实际仍存在的公开抽奖接口。

## 本轮实测结果

| 检查 | 结果 |
| --- | --- |
| `node --test tests/*.test.mjs` | 362 项全部通过 |
| Java 完整测试发现结果 | 339 项：243 通过，96 按各自环境条件跳过；失败/错误均 0 |
| 其中接口路由/OpenAPI/活动推送单元/真实活动集成 | 5 + 1 + 8 + 2 项，全部通过 |
| TypeScript 检查、修改的 JS/TS 文件 ESLint | 全部通过 |
| 手机号入口真实浏览器 | 唯一身份、多身份选择、拒绝后重试及手机/桌面通过 |
| 原生 EventSource + React StrictMode | 390px/1440px 首次快照、静置、更新、重连、隐藏后恢复、购物车保留及零旧 GET 通过 |
| H5 订单/本机草稿真实浏览器 | 390px/1440px 无订单轮询、最新状态检查、503 保留、草稿恢复/失效、直接提交及存储受限通过 |

本轮从源码编译 Java。前端未重新生成生产构建，Node 中两项已有 HTML/资源检查使用工作区已有构建；当前源码另由类型检查、行为测试和 Vite 实际组件浏览器测试验证。

真实后端集成仅连接固定测试网络 `order-show-activity-info-test` 的临时 MySQL/Redis；已有迁移只应用到合成测试库。测试容器与网络已清理。日志位于忽略目录 `outputs/retired-public-activity/`，浏览器截图在各脚本原有输出目录。

未启用完整独立 API E2E、其他数据库专项或容量压测，因此不将其计为通过；受影响 E2E 源码已编译，公开首帧读取分别由真实后端 SSE 测试及 Node 合成 HTTP 测试覆盖。未执行需要完整测试栈的背景上传/时间/全流程浏览器脚本。本次没有构建或部署业务镜像、修改业务库、重启业务服务或推送。

## 兼容边界

当前前端活动初始化和重连均不依赖旧 GET，回归中无旧 GET 请求。仍缓存旧代码的浏览器或外部调用方访问旧路径会收到 404，需要更新前端或脚本；部署新前端后重新打开页面才能使用新流程。删除后端入口不会停止旧客户端已有定时器，但不会再通过该路径读取活动资料。

如果需要撤回本轮清理，应恢复被删除的精确 GET 映射、对应函数及契约；本轮没有数据库变化需要回退。现有业务服务并未部署本轮改动。

## 复现

```powershell
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false

docker compose -f tests/activity-info.compose.yml up -d --wait --pull never
docker run --rm --network order-show-activity-info-test `
  -e ORDER_SHOW_ACTIVITY_INFO_TEST=order-show-activity-info-test `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml test
docker compose -f tests/activity-info.compose.yml down

# 已安装 Playwright / 浏览器可通过 ORDER_SHOW_PLAYWRIGHT_MODULE / ORDER_SHOW_BROWSER_PATH 指定。
node scripts/test-h5-entry.mjs
node scripts/test-h5-manual-refresh-browser.mjs
```
