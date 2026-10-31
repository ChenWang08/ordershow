# 活动公开资料 SSE 同步：源码与验证记录

## 范围与交付状态

本轮仅替换公共活动资料的 15 秒轮询，涵盖手机端、看板、排行、战报、抽奖页共用的活动运行信息。商品目录没有增加推送或自动刷新。后台按需刷新、手机订单/变更申请按需刷新（普通刷新 15 秒冷却）及大屏手动统计规则保留。

新增 V042 迁移，仅增加 `activity.public_info_version BIGINT NOT NULL DEFAULT 1`。后台 `activity.version` 继续用于配置保存冲突检查；独立同步版本不作为订单版本或 outbox 续传游标。

这是待部署源码。验证只使用本地编译、合成 HTTP 页面及独立临时 MySQL/Redis；没有构建或部署业务镜像，没有运行迁移到业务库，没有替换、重启业务服务。代码纳入本次本地 Git 提交，未推送远程。

## 实现

- 新公共接口：`GET /api/v1/public/activities/{activityCode}/events`。验证手机号之前也可订阅，无客户身份和订单资料。
- 首次连接直接发送 `activity` 快照，之后只在公开资料改变时推送快照；浏览器不因此额外查询活动接口。
- 快照包含活动编号、名称、状态、开始/截止/整场结束时间、直播链接、背景、地区、客户类型等现有公开字段。
- 名称/时间配置、发布/撤回发布、手动与自动开始/截止/结束、重新开放、背景/直播链接、影响公开配置的名单增删及大区变更、名单发布、所属部门名称变化均记录通知。纯客户联系方式修改不触发活动资料通知。
- 业务数据、同步版本和 `ACTIVITY_INFO_CHANGED` 事件在同一事务提交。新增/修改商品和其他客户下单不会触发活动资料推送。
- 复用已有 500ms outbox 扫描，按原始事件筛出活动资料变化，再按活动合并。Redis 广播当前资料，各副本只对本机连接发送；发送失败的资料事件保留 PENDING，订单事件可继续确认。
- 每个活动的并发首次读取合并；一份序列化结果广播给该活动客户端。重复、旧版本、旧连接以及晚完成的旧首次读取不能覆盖已接受的新版本。
- 数据库快照在只读 REPEATABLE_READ 事务中读取，保证资料与同步版本一致。版本以十进制字符串传输，浏览器用 BigInt 比较。
- 资料加载与抽奖规则加载分开，抽奖接口失败不妨碍活动显示。
- 网络断开保留活动资料和购物车，只显示同步提示；手机全屏提示在手机容器内部。切换到其他活动才清理旧活动连接和数据。

## 连接与资源

| 参数/行为 | 实现 |
| --- | --- |
| 心跳 | `ACTIVITY_INFO_HEARTBEAT_MS`，默认 30000ms；只发送时间/间隔，不查询数据库或 Redis |
| 无消息检查 | 默认 90 秒；服务端提高心跳间隔时，客户端按至少 3 倍间隔调整 |
| 重连 | 约 2/4/8/16/30 秒逐步延长并加随机错开；关闭 EventSource 自带重试，避免双重重试 |
| 隐藏/离开 | 关闭连接和重试定时器；恢复时合并 visibilitychange/focus/pageshow，再同步当前快照 |
| 连接数 | `ACTIVITY_INFO_MAX_CONNECTIONS`，每副本默认 2000；超限返回 503；这是保护阈值，不是容量承诺 |
| 慢客户端 | 独立虚拟线程发送，最多保留一份最新资料与一个心跳；持续卡住的发送清理连接 |
| Redis 恢复 | 重新订阅时主动同步各活动现有连接，无需浏览器先断线 |
| 服务停止 | 生命周期先关闭 SSE 连接和 Redis 订阅，再进入 HTTP 优雅停止；避免长连接拖住停止流程 |
| 降级 | 不恢复定时业务查询；临时故障退避重连，不支持 SSE 的浏览器显示提示 |

首次注册连接早于读取快照；加载期间有更新时，新快照优先，防止“先读后订阅”的空窗。断线不补历史事件，每次连接只需要当前资料。CLOSED/FINISHED 状态仍可订阅，保证重新开放可见。

服务器原有活动生命周期任务每 30 秒检查一次；自动状态流转因此可能延迟约一个检查周期再加排队及网络耗时，不能把 500ms outbox 扫描当成端到端延迟保证。提交订单、保存草稿、创建变更申请等接口继续使用服务器当前活动状态/时间及原有权限、版本检查。

## 验证

### 前端行为测试

`node --test tests/*.test.mjs`：327 项通过。新增覆盖首次快照、无周期查询、BIGINT 版本、重复/乱序、旧连接、网络退避、心跳超时、隐藏/bfcache 恢复、活动切换、不可用活动、抽奖加载失败，以及后台按需刷新兼容。

最终类型检查与修改文件 ESLint 均通过，使用本地已安装工具运行，没有安装依赖。前端生产源码编译通过；这是源码编译，没有构建业务镜像。

### 后端

普通 Maven 测试首轮：269 项，202 通过，67 项由各自集成环境门控跳过。活动连接服务测试覆盖 300 个同时订阅只合并读取、订阅空窗保护、旧快照、新客户端、时间派生状态、消息缓冲上限、心跳无业务读取、连接限额、断开清理。

最终定向运行 `ActivityInfoIntegrationTest`、`ActivityInfoStreamServiceTest`、`RealtimeEventServiceTest` 和 `OpenApiContractTest`，19 项全部通过。

`ActivityInfoIntegrationTest` 通过固定专用测试库和 Redis 启动测试应用，使用真实 Tomcat HTTP SSE，另建第二套推送服务/Redis 订阅代表另一个副本。验证 V042 迁移、回滚不留下通知或版本变化、直播链接更新、截止、整场结束后建立新连接、重新开放、订单噪声隔离、Redis 订阅恢复和应用停止清理。恢复场景实际停止第二个 Redis 订阅，在停订期间提交活动变化，再启动订阅，原有客户端收到最新资料；应用优雅停止未被 SSE 连接拖住。第二实例使用捕获器接收 SSE 写入；这不是双节点 Ingress 容量测试。

### 真实浏览器

`scripts/test-activity-info-browser.mjs` 最终运行通过。使用真实 React StrictMode 工作区与原生 EventSource，HTTP 仅包含合成数据；覆盖 390px/1440px、手机号验证前收到活动、抽奖接口 503、模拟静置 65 秒无资料查询、编辑购物车保留、大屏统计不随活动变化/重连查询、断线退避、隐藏期间更新后恢复，以及手机全屏同步提示。已查看 390px 断线截图，提示可见，购物车数量与金额保持。

测试日志和截图写入忽略目录 `outputs/activity-info/`。测试完成后，已关闭并移除本轮专用临时 MySQL、Redis 容器及测试网络。

## 复现

```powershell
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false

# 固定命名且没有业务数据、持久卷或主机端口的临时依赖；使用本机已有镜像。
docker compose -f tests/activity-info.compose.yml up -d --wait --pull never
docker run --rm --network order-show-activity-info-test `
  -e ORDER_SHOW_ACTIVITY_INFO_TEST=order-show-activity-info-test `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -f backend/pom.xml `
  '-Dtest=ActivityInfoIntegrationTest,ActivityInfoStreamServiceTest,RealtimeEventServiceTest,OpenApiContractTest' test
docker compose -f tests/activity-info.compose.yml down

# 如 Playwright 不在项目依赖中，可通过 ORDER_SHOW_PLAYWRIGHT_MODULE 指向已有安装。
node scripts/test-activity-info-browser.mjs
```

## 部署时的必要核对

本轮没有执行下列部署动作：业务库先应用 V042；前后端配套更新；目标代理对活动 SSE 路径关闭响应缓冲/缓存/压缩积攒，读超时建议至少 120 秒且大于心跳间隔；多副本使用同一 Redis；滚动停止能释放连接。该阶段保留的旧活动 GET 已在随后清理中删除；当前旧客户端兼容限制及回归结果见[旧活动接口清理验证](retired-public-activity-2026-10-31.md)。

隔离功能验证证明请求触发和同步行为，不证明 ACK 单核、多副本、真实 Ingress 下的容量或 500/503 根因已解决。实际连接内存、CPU、文件句柄、写延迟及代理断线行为仍需目标环境验收。
