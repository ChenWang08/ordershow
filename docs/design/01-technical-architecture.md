# 订购会系统整体技术架构

## 1. 架构目标

系统面向多场订购会，服务客户 H5、管理后台、排行大屏、专题战报和抽奖大屏。第一期重点不是无限规模，而是保证订单、导入、统计和抽奖结果一致、可追溯，并能在活动现场稳定运行。

设计目标：

- 支撑单场约千人同时在线、几百个商品，并按 2 倍目标完成压测；
- 所有业务数据按活动隔离，历史活动完整保留；
- 订单重复提交不产生重复订单，并发修改不会静默覆盖；
- 看板在订单变化后 3 秒内更新；
- 同一抽奖轮次只能生成一份有效结果；
- 本地、测试、预发布和正式环境使用同一套代码，通过配置切换基础设施；
- 第一期保持简单可运维，不提前引入微服务和外部消息队列；当前本地版由 Spring Boot 应用内执行任务，生产环境目标再拆分 MySQL DB Task Queue 和独立 Background Worker。

## 2. 总体选择

当前实现采用“统一 React 业务前端 + Spring Boot 模块化单体 + MySQL + Redis + S3 兼容对象存储 + SSE”的架构；后续正式集群可将耗时任务拆成独立 Worker 运行角色。

| 层次 | 当前实现或生产目标 | 职责 |
| --- | --- | --- |
| 统一业务前端 | React、TypeScript、Vinext、Vite、现有自定义 UI | 同一工程提供 H5、管理后台、排行、专题战报和抽奖；不引入 Ant Design |
| API | Java 21、Spring Boot 3.5 稳定线 | 业务规则、认证、事务、统计和文件协调 |
| 本地后台任务 | Spring Boot 应用内执行器 + MySQL 任务记录 | Excel 解析、预览和发布 |
| 生产后台任务目标 | 独立 Spring Boot Worker + MySQL DB Task Queue | 导入、导出、outbox、调度和清理的独立运行角色 |
| 数据访问 | MyBatis/MyBatis Plus、Flyway | SQL、迁移、事务和乐观锁 |
| 主数据库 | MySQL 8.4 LTS / InnoDB | 唯一业务事实来源 |
| 辅助数据 | Redis | 限流、短期凭证缓存、查询缓存、幂等结果缓存和分布式锁；不作为事实来源 |
| 文件 | MinIO（本地）/ S3 兼容对象存储（正式） | Excel、ZIP、商品图片和导出文件 |
| 实时更新 | SSE | 看板和抽奖状态单向推送 |
| 正式入口 | 托管 LB/WAF/CDN | TLS、健康检查、流量分发、基础防护和静态资源分发 |

当前 Vinext 构建会生成服务端页面外壳，核心业务交互在客户端执行；系统没有 SEO 依赖。生产环境可继续运行当前前端服务，也可在完成路由和缓存验证后演进为静态资源/CDN 部署。

## 3. 前端应用划分

当前 H5、管理后台和现场大屏共用一个 React 工程、主题和 API 层。下面是团队扩大后的可选演进结构，不是当前目录结构：

```text
frontend/
├── apps/
│   ├── h5/                 客户订货
│   ├── admin/              管理后台
│   └── screen/             排行、战报和抽奖大屏
├── packages/
│   ├── api-client/         OpenAPI 生成的客户端和类型
│   ├── domain/             纯业务类型、格式化和计算展示
│   ├── ui/                 通用组件
│   └── theme/              固定主题资源
└── pnpm-workspace.yaml
```

当前前端入口为 `app/order-show-app.tsx`，活动路由位于 `app/activity-routes.tsx`，正式接口仍通过 `app/api.ts` 使用，所有关键业务数据以后端为准。页面、共享状态、后台、H5、大屏与样式已按模块整理；商品、导入、订单和价格同步后端也已分离职责。现有业务契约保持，模块边界见 `09-frontend-module-boundaries.md`、`10-catalog-import-module-boundaries.md` 和 `11-screen-style-module-boundaries.md`。

### 3.1 推荐路由

```text
/h5/:activityCode
/h5/:activityCode/order
/h5/:activityCode/order/current

/admin/login
/admin/activities
/admin/activities/:activityId/overview
/admin/activities/:activityId/products
/admin/activities/:activityId/customers
/admin/activities/:activityId/attendees
/admin/activities/:activityId/orders
/admin/activities/:activityId/lottery
/admin/activities/:activityId/imports
/admin/audit-logs

/screen/:activityCode/ranking
/screen/:activityCode/report
/screen/:activityCode/lottery
```

活动必须由路径参数或经过校验的后台活动选择器确定，禁止依赖全局默认活动查询业务数据。

## 4. 后端模块化单体

后端为单个部署单元，内部模块之间只能通过应用服务或明确的领域接口调用；禁止跨模块随意访问 Mapper。

```text
com.fengyi.ordershow
├── activity       活动、入口编码、时间和状态
├── catalog        商品、图片、分公司范围
├── customer       永久客户、活动白名单、H5 验证、到场名单
├── importjob      Excel/ZIP 解析、当前批次预览、确认和错误明细
├── ordering       订单、当前明细、版本、撤回和重新提交
├── dashboard      排行、专题统计、缓存和 SSE 通知
├── lottery        规则、轮次、候选快照、中奖结果
├── admin          管理员账号和会话
├── audit          审计日志
├── file           对象存储和导出任务
└── shared         通用错误、ID、时钟、数据库和安全基础设施
```

### 4.1 一致性边界

- 提交订单：订单主表、当前明细、版本、版本明细、操作记录在一个 MySQL 事务内完成。
- 客户在 H5 撤回订单：状态变化和操作记录在同一事务内完成，不创建空版本；活动开始后管理员可按角色和活动状态新增、调整、恢复或逻辑作废订单，写操作与审计记录在同一事务内完成。
- 商品调价：商品当前价格、阶梯规则和当前活动已提交订单的当前明细在同一个 MySQL 事务内更新；只回写 `order_item` 与订单总金额，不改变订单数量、吨数、当前版本号或订单操作记录。事务提交后通过 outbox 使看板、H5 和导出读取最新金额。
- 确认导入：解析和预览先写 staging；发布版本准备完成后，在一个短 MySQL 事务内切换活动 + 数据类型的当前版本指针；原始文件已先上传对象存储。
- 执行抽奖：轮次锁定、候选快照、中奖结果和审计引用在同一事务内完成。
- SSE 推送不参与主事务；事务提交后发布“数据已变化”事件，失败时由短周期补偿刷新兜底。

### 4.2 Background Worker 与 DB Task Queue

当前本地版本只有一个 Spring Boot 运行进程：API 创建 MySQL 导入任务，应用内执行器完成解析和发布；Flyway 在后端启动时执行。该方式满足本地开发和首版联调，但不能描述为已经完成独立 Worker 或独立 Migration Job。

生产部署目标是把 API、Background Worker 和数据库迁移拆成三个运行职责：API 负责鉴权、创建任务和查询状态；Worker 领取并执行耗时任务；Flyway 由独立发布步骤执行。API 与 Worker 可以复用同一个 Spring Boot 制品，但通过不同 profile/启动命令运行。

生产拆分时仍不引入 Kafka/RabbitMQ，`import_task`、`export_task` 及其他任务记录组成 MySQL DB Task Queue：

- API 在短事务内创建 `PENDING/UPLOADED` 任务并返回 `202 + taskId`；即使 API 在创建任务后立即重启，Worker 仍可从 MySQL 扫描到任务；
- Worker 使用短事务领取任务，采用状态条件更新或 `SELECT ... FOR UPDATE SKIP LOCKED`，并写入 `worker_id`、`locked_until`、`attempt_count` 和 `next_attempt_at` 等租约字段；
- 任务处理器必须幂等。租约过期后可以重新领取，失败按退避策略重试，超过上限进入 `FAILED`/人工处理状态；重启时不能把未知结果盲目重做；
- Excel 解析、导出、outbox 发布、活动状态调度和清理由 Worker 执行。订单提交和抽奖结果保存仍由 API 的短事务完成；Excel 确认的最终发布也由 Worker 执行，但只在最后阶段进行短事务原子切换；
- Redis 可以用于唤醒提示、缓存和分布式锁，但不能作为任务唯一队列。队列积压、租约超时、失败任务和 Worker 健康状态必须有监控告警。

## 5. 数据架构

### 5.1 MySQL 是唯一事实来源

订单、版本、活动客户、导入批次、候选快照和中奖结果以 MySQL 为准。Redis 清空或重启不得导致业务记录丢失，也不得改变已经产生的中奖结果。

所有活动业务表包含 `activity_id`；核心唯一约束也包含 `activity_id`。查询层必须通过活动范围检查器强制带入活动 ID。

### 5.2 Redis 使用范围

- H5 验证失败频率计数；
- 管理员会话或会话撤销标记；
- 短期 H5 凭证辅助撤销；
- 商品目录和看板查询缓存；
- HTTP 幂等响应缓存；
- 抽奖轮次分布式互斥锁；
- SSE 实例间通知（多实例部署时）。

Redis 不保存唯一订单副本、唯一中奖副本或关键幂等事实。Redis 只用于加速重复请求、缓存查询结果和提供互斥锁；缓存丢失后必须回到 MySQL。分布式锁之外仍使用数据库唯一约束、幂等记录和乐观锁作为最后防线。

### 5.3 对象存储

对象键不得使用用户上传文件名直接拼接，建议：

```text
activities/{activityId}/imports/{importTaskId}/source.xlsx
activities/{activityId}/imports/{importTaskId}/images.zip
activities/{activityId}/products/{productId}/{contentHash}.{ext}
activities/{activityId}/exports/{exportTaskId}.xlsx
```

数据库保存对象键、内容摘要、大小、MIME 类型和引用关系。仍被商品或订单快照引用的图片不能物理删除。

商品图片二进制不写入 MySQL：原始 ZIP、Excel 和图片文件保存到 MinIO/S3 兼容对象存储，MySQL 只保存导入任务、商品说明、图片文件元数据及商品图片关联。图片匹配只使用完整标准化物料名称；商品名称中的 `/` 属于名称内容，ZIP 目录路径单独解析，不能截断商品名称。

## 6. 认证和访问边界

### 6.1 管理员

- 支持 `SUPER_ADMIN` 超级管理员和绑定部门的 `DEPARTMENT_ADMIN` 部门共享账号；每个部门最多一个部门账号；部门编码创建时由服务端生成且永久不变；
- 使用账号密码登录，密码使用 Argon2id 或 BCrypt 哈希；
- 登录成功后使用 Secure、HttpOnly、SameSite Cookie；
- 超级管理员第一次登录必须修改初始密码；部门共享账号的登录密码由超级管理员统一设置和重置，部门账号不能自行修改；
- 管理员接口全部进行服务端鉴权和 CSRF 防护；
- 每个敏感操作记录管理员 ID；部门共享账号的审计粒度明确到部门账号、会话和 IP，不能识别部门内部具体操作者。

### 6.2 H5 客户

- 当前白名单存在客户类型时，用户先选择活动入口和客户类型，再提交手机号；客户类型全部为空时隐藏通道和大区选择，直接提交手机号；
- 有类型时后端按 `activity_id + customer_type + normalized_phone` 精确匹配有效白名单；无类型时使用内部 `ALL`，按 `activity_id + ALL + normalized_phone` 匹配；
- 验证成功设置只允许访问当前活动和当前活动客户的短期不透明会话 Cookie；
- 凭证过期时间不晚于活动结束时间；
- Cookie 使用 `Secure; HttpOnly; SameSite=Lax`，并限制到 H5 API 路径；H5 写操作同时校验 CSRF Token 和 Origin。浏览器不在 `localStorage`、`sessionStorage` 或 URL 中保存凭证；
- 服务端每次访问仍检查客户是否属于当前白名单，客户被删除、活动提前截止或显式撤销时立即失效；
- 只有在 H5 与 API 无法通过同站点入口部署时，才使用 Bearer Token 作为跨站例外，并重新评估 CORS、Token 存储和撤销策略；
- 不做短信验证码和业务性失败锁定，但保留宽松限流、访问事件和异常告警。

手机号证明的是“知道白名单手机号”，不证明实际持有手机。该业务风险已在 ADR-004 中接受。

## 7. 接口和实时通信

- REST JSON 用于所有命令和普通查询；
- OpenAPI 是前后端字段契约；
- 文件使用 `multipart/form-data` 上传，通过任务接口查询解析和导出结果；
- 看板和抽奖页面使用 SSE 接收活动级变更事件；
- SSE 只推送版本号或失效事件，不在事件中发送完整敏感业务数据；
- 客户端收到事件后重新调用有权限的统计或抽奖查询接口；
- 入口代理对 SSE 路由关闭响应缓冲并设置足够长的读取超时；托管 LB 必须支持心跳、断线重连和连接优雅摘除。

第一期不需要 WebSocket。抽奖的“开始、揭晓、完成”由 REST 命令触发，SSE 负责把最新状态推送到现场页面。

## 8. 性能设计

目标基线：

| 场景 | 目标 |
| --- | --- |
| 同时在线 | 1000，验收压测 2000 |
| 商品数 | 单场数百个 |
| 手机验证 | P95 小于 500ms（不含网络） |
| 商品列表 | 缓存命中 P95 小于 300ms |
| 订单提交 | P95 小于 1s，事务完成后返回 |
| 看板更新 | 订单成功后 3s 内可见 |
| 抽奖执行 | 单轮命令只成功一次 |

实现策略：

- 商品图片直连对象存储/CDN，API 不转发图片二进制；
- 商品目录按活动、客户类型和分公司范围缓存；
- 订单写入使用短事务，不同步执行大规模统计查询；
- 看板读取预聚合缓存，缓存失效时从 MySQL 重建；公司金额排行默认 TOP90、分公司金额排行默认 TOP30；
- 列表全部服务端分页；
- 导入和导出使用任务模式，避免长 HTTP 请求占用连接；
- 正式环境至少两个 API 实例，抽奖使用 Redis 锁 + MySQL 条件更新，关键幂等使用 MySQL 持久记录，Redis 只做加速。

## 9. 本地和正式部署

### 9.1 本地开发

本地即可完成全部功能，不要求现在确定云厂商：

```text
Docker Compose: 统一 React 前端 + Spring Boot 后端 + MySQL + Redis + MinIO
```

通过 `.env` 或 Spring Profile 提供数据库、Redis、对象存储和域名配置。代码中禁止判断具体云厂商。

### 9.2 环境隔离

| 环境 | 数据库 | Redis | 对象存储 | 数据要求 |
| --- | --- | --- | --- | --- |
| local | 独立 | 独立 | 本地 MinIO | 演示/脱敏数据 |
| test | 独立 | 独立 | 独立桶 | 测试数据 |
| staging | 独立 | 独立 | 独立桶 | 上线演练数据 |
| production | 独立 | 独立 | 独立桶 | 正式数据 |

测试和预发布禁止连接正式数据库。正式活动必须重新导入审核后的文件。

### 9.3 正式拓扑最低建议

- 托管 LB/WAF/CDN：由云厂商提供入口高可用、TLS、健康检查和流量分发；不把单台 Nginx 描述为 HA 入口；
- 静态前端：对象存储/CDN；Nginx 只可作为本地开发入口或 API 实例内的反向代理；
- API：2 个容器实例；
- Background Worker：至少 1 个独立任务实例，按任务积压和现场容错要求扩展；
- MySQL：托管高可用或主备，并启用自动备份；
- Redis：可用性按现场容错要求配置；
- 对象存储：版本控制或生命周期策略；
- 监控：健康检查、JVM、HTTP、数据库连接池、订单失败率、SSE 在线数；
- 日志：结构化日志集中检索，敏感字段脱敏。

当前本地环境由 Spring Boot 启动时执行 Flyway。正式发布目标顺序为：备份/检查 → 独立 Migration Job 执行 Flyway → 校验成功 → 发布 API 和 Worker。API/Worker 使用无 DDL 权限的运行账号，启动时只做 schema 校验或不做迁移；迁移失败时停止发布，不允许两个 API 实例各自执行升级。

第一期不使用 Kubernetes；只有组织已有成熟 Kubernetes 平台时才部署到现有集群。

## 10. 可观测性与恢复

- 每个请求生成 `trace_id`，响应错误和审计记录均关联该 ID；
- 订单提交、导入确认、抽奖执行使用业务指标单独监控；
- 对验证异常增长、订单错误率、数据库连接池耗尽、SSE 大量断开和抽奖失败告警；
- 数据库每日全量备份并配合增量/binlog；
- 对象存储开启版本或防误删策略；
- 上线前实际执行数据库和对象文件恢复演练；
- Redis 允许重建，不作为订单恢复来源。

## 11. 开发顺序

1. 工程骨架、Flyway、统一错误、认证、审计和对象存储接口；
2. 活动管理和多活动入口；
3. 商品、白名单、到场名单及导入批次；
4. H5 验证、商品查询、订单提交/版本/撤回；
5. 管理后台订单和导出；
6. 看板统计与 SSE；
7. 抽奖规则、候选快照和结果；
8. 全链路测试、2 倍并发压测、备份恢复和现场断网演练。

## 12. 暂不引入的能力

- 微服务注册中心、服务网格；
- Kafka/RabbitMQ；
- Kubernetes（除非使用现有成熟平台）；
- 支付、库存、物流、发票和 ERP 自动同步；
- H5 客户账号密码和短信验证码；
- 多级订单审批；
- 把图片二进制存入 MySQL。
