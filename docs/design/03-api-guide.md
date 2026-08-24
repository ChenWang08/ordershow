# 订购会系统 API 设计约定

## 1. 契约原则

- OpenAPI 文件 `openapi/order-show-api.yaml` 是前后端字段契约；
- 所有正式业务计算、权限和状态检查在后端执行；
- API 版本前缀固定为 `/api/v1`；不兼容修改发布 `/api/v2`，不得静默改变旧字段含义；
- JSON 字段使用 `camelCase`，数据库字段使用 `snake_case`；
- 当前 API 的自增 ID 在 JSON 中按 `integer/int64` 返回，前端使用 `number`；应保证对外 ID 不超过 JavaScript 安全整数，未来改用更大 ID 或 ULID 时须统一升级契约；
- 所有时间使用 ISO 8601 UTC，例如 `2026-08-20T08:30:00.123Z`；
- 当前 API 将金额、价格、吨数和转换系数按 JSON number 返回；权威计算始终由后端使用 `BigDecimal` 完成，前端浮点数只用于展示，不能作为订单结算依据。

## 2. API 分区

| 前缀 | 调用方 | 认证方式 |
| --- | --- | --- |
| `/api/v1/public` | 未验证 H5、公开大屏 | 无；只返回非敏感信息并限流 |
| `/api/v1/h5` | 已验证活动客户 | Secure、HttpOnly、SameSite Cookie + CSRF Token；跨站部署才使用 Bearer Token |
| `/api/v1/admin` | 管理后台和抽奖操作员 | Secure HttpOnly Cookie + CSRF Token |
| `/api/v1/screen` | 现场只读页面 | 活动编码 + 可撤销 screen token（正式环境） |

H5 会话绑定 `activityId`、`activityCustomerId`、`customerType`、过期时间和会话 ID。默认使用不透明 HttpOnly Cookie，服务端不接受客户端另外指定其他客户 ID；若因跨站部署使用 Bearer Token，仍必须具备同样的活动和客户绑定。

## 3. 统一响应

### 3.1 成功

单资源：

```json
{
  "data": {
    "id": 123
  },
  "traceId": "01J5ABC..."
}
```

分页：

```json
{
  "data": [],
  "page": {
    "number": 1,
    "size": 50,
    "totalElements": 1680,
    "totalPages": 34
  },
  "traceId": "01J5ABC..."
}
```

创建异步任务返回 HTTP 202；创建普通资源返回 HTTP 201；无响应体的成功操作返回 HTTP 204。

### 3.2 错误

错误响应采用 `application/problem+json`：

```json
{
  "type": "https://order-show.example/problems/order-version-conflict",
  "title": "订单已在其他页面更新",
  "status": 409,
  "code": "ORDER_VERSION_CONFLICT",
  "detail": "请刷新当前订单后重新提交",
  "traceId": "01J5ABC...",
  "fieldErrors": []
}
```

不得把数据库异常、堆栈、对象存储内部地址或密钥返回给客户端。手机号明文只允许在已鉴权的白名单、现场到场管理接口中按权限返回；公开接口、H5、订单、排行、战报、抽奖大屏和错误响应只能返回脱敏值或不返回。

## 4. 认证和会话

### 4.1 管理员

1. `POST /admin/auth/login` 验证账号和密码；
2. 服务端设置 HttpOnly 会话 Cookie，并返回 CSRF Token；
3. 任何修改请求同时携带 `X-CSRF-Token`；
4. `POST /admin/auth/logout` 撤销当前会话；
5. 禁用管理员账号时撤销其全部会话。

管理员手机号返回规则：

- 白名单列表/详情可返回完整 `phone` 和 `confirmerPhone`，现场到场列表/详情可返回完整 `phone`；
- 订单列表、订单详情及导出仍只使用脱敏手机号；
- 完整手机号不得下发给公开/H5/screen 接口，也不得写入普通日志和错误响应。

### 4.2 H5

1. `GET /public/activities/{activityCode}` 获取活动公开信息；
2. 用户选择客户类型并调用 `POST /public/activities/{activityCode}/verify-phone`；
3. 后端标准化手机号并计算 HMAC，与有效活动白名单精确匹配；
4. 验证成功设置 H5 HttpOnly Cookie，返回 CSRF Token、客户展示信息和截止时间；
5. Cookie 最晚在活动结束时过期，且服务端每次访问检查该活动客户状态，只能访问该活动客户的商品和订单。

H5 与 API 默认通过同站点托管入口提供。H5 的写请求必须携带 CSRF Header，并校验 `Origin`；Cookie 不放入 URL、`localStorage` 或 `sessionStorage`。若部署为跨站 API，才启用 Bearer 方案，并显式配置 CORS 和凭证撤销。

相同手机号可在综合和特渠分别匹配；通道不一致返回 `CUSTOMER_CHANNEL_MISMATCH`，不自动切换身份。

## 5. 分页、筛选和排序

- `page` 从 1 开始；
- 默认 `pageSize=50`，允许 20、50、100；订单和审计最大 100；
- 所有排序必须包含唯一 ID 作为最终稳定排序字段；
- 普通列表搜索先标准化输入；手机号只支持完整号码精确匹配；
- 所有活动资源 API 都从路径取得 `activityId`，不得只在查询参数中传活动 ID。

## 6. 幂等和并发

### 6.1 幂等键

以下命令必须携带 `Idempotency-Key`：

- H5 提交/修改订单；
- H5 撤回订单；
- 确认导入；
- 开始抽奖、完成轮次和重置轮次；
- 创建导出任务。

规则：

- 由客户端为一次用户动作生成 UUID/ULID；
- 同一调用者、接口和幂等键重复请求，载荷一致时返回第一次结果；
- 幂等键相同但载荷不同，返回 409 `IDEMPOTENCY_KEY_REUSED`；
- `PROCESSING` 状态重复请求返回 409/202 并携带可重试提示；
- 订单和抽奖的幂等记录至少保留到活动归档后 30 天。

关键幂等记录、请求指纹、任务 ID 和可重放响应摘要最终保存于 MySQL 的 `api_idempotency`。Redis 可以在命中时加速重复请求和互斥，但缓存丢失、过期或重启后必须回到 MySQL，不得因此重新执行订单版本、导入发布或抽奖结果。

### 6.2 乐观锁

- 订单提交请求包含 `expectedVersion`；
- 活动和后台单条编辑使用 `If-Match: "<version>"`；
- 版本不匹配返回 409，不允许后写静默覆盖先写；
- 导入任务和抽奖轮次还使用数据库条件更新状态。

## 7. 文件导入

```text
POST 上传文件 → 202 + taskId
GET 任务 → UPLOADED / PARSING / PREVIEW_READY / CONFIRMING / MATERIALIZING / READY_TO_PUBLISH / PUBLISHING / COMPLETED / FAILED / CANCELLED
GET 预览行和错误 → 管理员编辑/删除预览行
POST 确认 → CONFIRMING → MATERIALIZING → READY_TO_PUBLISH → PUBLISHING → COMPLETED
```

- 上传限制由配置控制，默认 Excel 50MB、图片 ZIP 1GB、单图片 10MB；
- 服务端校验扩展名、MIME、文件签名和 SHA-256；
- 相同活动、类型和文件哈希的重复上传给出提示，但不擅自覆盖；
- 阻断错误未解决时不能确认；
- 解析和预览只写 staging；当前由 Spring Boot 应用内任务执行器准备并发布数据，生产环境可拆为独立 Worker；发布事务失败时不得留下半批有效数据；
- 发布事务失败时当前目录保持不变，旧版本可以审计或回滚；
- 活动开始后默认禁止 Excel 全量导入和图片 ZIP 批量导入。

### 7.1 现场到场全量替换与关联

- 每次发布现场到场 Excel 都创建新的完整 `ATTENDANCE` 版本，当前列表不合并或继承上一版本记录及关联；
- 后端在参会人员类型对应的客户通道内，按手机号唯一、经销商全称唯一、同分公司经销商简称唯一依次精确匹配，不做模糊匹配；
- 响应返回 `matchStatus`、`matchMethod`、`matchReasonCode`、`matchedDealerName` 和 `lotteryEligible`；
- `matchStatus` 只有 `MATCHED`、`PENDING_CONFIRMATION`、`UNMATCHED`；当前列表可按状态筛选；
- 手机号与名称指向不同客户、全称与简称冲突或存在多个候选时返回 `PENDING_CONFIRMATION`，不能静默选择第一条；
- 白名单发布后，服务端立即重算当前到场版本的全部关联；只有 `lotteryEligible=true` 的记录进入现场到场抽奖候选池。

## 8. 订单 API 规则

H5 只提交商品 ID 和箱数：

```json
{
  "expectedVersion": 2,
  "items": [
    { "productId": 301, "quantity": 20 }
  ]
}
```

后端必须重新加载活动商品并校验：

- 活动进行中且未截止；
- 活动客户有效；
- 商品属于活动、客户类型匹配、当前可见且 `isOrderable=true`；缺少物料代码或吨箱转换系数不影响可订，缺少有效元/箱时必须拒绝加入订单；
- 分公司定制范围匹配；
- 数量为正整数且不超过配置上限；
- 至少有一条有效商品；
- 金额全部由后端计算；吨数在转换系数完整时由后端计算，任一明细无法换算时订单总吨数返回 `null`，不能返回部分合计。

撤回不会删除当前明细或创建空版本。重新提交沿用原订单号，并生成下一个版本号。

## 9. 看板和 SSE

看板查询只读取：当前活动、`SUBMITTED` 订单、当前明细。已撤回订单完全排除。

SSE 示例：

```text
event: dashboard.invalidated
id: 938201
data: {"activityId":"12","version":"452"}
```

支持事件：

- `dashboard.invalidated`；
- `lottery.round.updated`；
- `activity.status.changed`；
- `heartbeat`。

客户端使用事件 ID 重连；无法续传时重新获取完整快照。SSE 中不发送手机号、订单明细或管理员信息。

## 10. 抽奖 API 规则

- 候选主体是 `activity_customer`，即经销商活动身份；
- 同一轮通过数据库唯一约束去重；
- `VALID_ORDERS` 只读取资格截止时间前的当前 `SUBMITTED` 订单；
- `ATTENDEES` 至少存在一条有效到场记录，并按活动客户 ID 去重；
- 默认排除本活动已有 `VALID` 中奖记录；
- 后端使用密码学安全随机数，不接受前端提供随机结果；
- 候选快照和中奖记录持久化成功后，现场页才能揭晓；
- 重置不删除旧结果，而是标记失效并保存原因。

## 11. 核心错误码

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 字段或业务格式错误 |
| 401 | `ADMIN_UNAUTHENTICATED` | 管理员未登录或会话失效 |
| 401 | `H5_TOKEN_INVALID` | H5 凭证无效或过期 |
| 403 | `ACTIVITY_SCOPE_FORBIDDEN` | 访问了令牌以外的活动 |
| 404 | `ACTIVITY_NOT_FOUND` | 活动不存在或入口不可用 |
| 404 | `PHONE_NOT_IN_WHITELIST` | 手机号未匹配当前通道白名单 |
| 409 | `CUSTOMER_CHANNEL_MISMATCH` | 选择通道与白名单身份不一致 |
| 409 | `ACTIVITY_NOT_OPEN` | 活动未开始 |
| 409 | `ACTIVITY_CLOSED` | 活动已截止或归档 |
| 409 | `ORDER_VERSION_CONFLICT` | 订单已被其他请求更新 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 幂等键被不同载荷复用 |
| 409 | `IMPORT_HAS_BLOCKING_ERRORS` | 导入存在未处理阻断错误 |
| 409 | `IMPORT_STATE_CONFLICT` | 导入任务状态不允许该操作 |
| 409 | `LOTTERY_ROUND_STATE_CONFLICT` | 轮次状态不允许执行 |
| 409 | `LOTTERY_NOT_ENOUGH_CANDIDATES` | 候选人数少于中奖人数 |
| 413 | `FILE_TOO_LARGE` | 文件超过限制 |
| 422 | `PRODUCT_NOT_ORDERABLE` | 商品无效、越权或分公司不匹配 |
| 429 | `RATE_LIMITED` | 请求过于频繁 |
| 500 | `INTERNAL_ERROR` | 内部错误，客户端使用 traceId 报障 |

手机号不在白名单使用 404 是业务接口选择，不返回该手机号是否存在于其他活动的信息。

## 12. 接口目录

### 12.1 公开/H5

- 查询活动公开信息、验证手机号；
- 查询本人可见商品目录；响应明确 `isOrderable`，价格缺失的商品可见但不可加入订单；
- 查询本人当前订单及版本；
- 提交、修改、撤回和重新提交订单。

### 12.2 管理员

- 登录、退出、当前管理员、修改密码；
- 活动列表、创建、编辑、状态迁移和二维码；
- 商品、白名单、到场名单列表与单条紧急编辑；
- 导入上传、预览、错误、确认和取消；
- 订单列表、详情、版本、操作记录、搜索、筛选和导出；管理员不能提交、修改或撤回订单；
- 抽奖规则、轮次、发布、执行、完成、重置和中奖导出；
- 审计日志和导出任务。

### 12.3 大屏

- 排行榜快照；
- 九类专题战报快照；
- 抽奖轮次和已保存结果；
- 活动级 SSE 事件流。

完整路径、参数和核心 Schema 见 OpenAPI 文件。
