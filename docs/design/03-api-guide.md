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
| `/api/v1/screen` | 现场只读页面 | 活动编号 + 可撤销 screen token（正式环境） |

H5 会话绑定 `activityId`、`activityCustomerId`、`customerType`、过期时间和会话 ID。默认使用不透明 HttpOnly Cookie，服务端不接受客户端另外指定其他客户 ID；若因跨站部署使用 Bearer Token，仍必须具备同样的活动和客户绑定。

客户页面可以使用 `/h5/{activityCode}` 进入指定活动；`/h5` 和 `GET /public/activities/current` 仅作为单活动兼容入口，多部门同时有活动时不作为正式入口。管理后台统一从 `/admin` 进入，当前活动由后台选择器决定；浏览器保存的选择仅是界面偏好，所有业务查询仍由服务端根据活动 ID 和部门范围隔离、鉴权。看板、战报和抽奖大屏使用 `/screen/{activityCode}/...` 指定活动。

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

不得把数据库异常、堆栈、对象存储内部地址或密钥返回给客户端。手机号明文只允许在已鉴权的白名单、现场到场和订单管理接口中按权限返回；公开接口、H5、排行、战报、抽奖大屏和错误响应只能返回脱敏值或不返回。

## 4. 认证和会话

### 4.1 管理员

1. `POST /admin/auth/login` 验证账号和密码；
2. 服务端设置 HttpOnly 会话 Cookie，并返回 CSRF Token；
3. 任何修改请求同时携带 `X-CSRF-Token`；
4. `POST /admin/auth/logout` 撤销当前会话；
5. 停用账号或重置密码时撤销其全部会话；停用部门撤销所属全部账号会话。超级管理员自行改密保留当前会话、撤销其他会话。

登录及 `GET /admin/me` 返回 roleCode、departmentId、departmentName、permissions。角色为 SUPER_ADMIN、DEPARTMENT_ADMIN、DEPARTMENT_MEMBER；成员权限为 OVERVIEW、PRODUCT、WHITELIST、ATTENDANCE、ORDER、LOTTERY。管理员按角色具有范围内全部模块权限，不依赖 permissions 数组。

成员使用本部门全部活动，不需要活动成员授权关系。读活动列表及基本详情支持筛选器；活动写操作始终仅限管理员。其他接口还检查模块权限及业务状态。成员不能自行改密，部门管理员同样不能自行改密。

| 接口 | 权限及语义 |
| --- | --- |
| GET /admin/members | 管理员查询成员；超级管理员可按 departmentId 筛选，部门管理员强制限定本部门 |
| POST /admin/members | 管理员创建成员；超级管理员指定部门，部门管理员自动绑定本部门；默认无权限 |
| PATCH /admin/members/{id} | 编辑姓名、替换权限、重置密码或启停；必须携带 lockVersion，冲突返回 409；不能改角色、用户名或部门 |
| GET /admin/activities/{activityId}/module-context | 至少一项模块权限；仅提供辅助计数、客户类型模式、白名单发布状态，不含个人明细 |
| GET /admin/activities/{activityId}/orders/customer-options | ORDER 权限，订单编辑所需客户查询，不授予白名单写权限 |
| GET /admin/activities/{activityId}/orders/product-options | ORDER 权限，订单编辑所需商品查询，不授予商品写权限 |

成员更新省略 permissions 保留原权限，传入数组整体替换，空数组收回全部权限；后续请求立即使用最新授权。成员姓名支持中英文或混合，非空且最多 100 字符；用户名为 3–64 位，以英文字母或数字开头，其余允许英文字母、数字及 `_ . @ -`。密码长度 8–100 位。

导入列表按授权模块过滤，单个导入任务依据数据库 import_type 校验；私有导入源文件校验所属活动和模块，公开商品图及奖品图沿用原公开规则。未授权返回 MODULE_PERMISSION_REQUIRED（403），仅限管理员操作返回 MANAGER_REQUIRED（403），访问其他部门资源返回 404，成员版本冲突返回 MEMBER_VERSION_CONFLICT（409）。

订单审核及历史响应中的 reviewedByName、submittedByAdminName、adminName 优先采用操作时身份快照，展示具体姓名及用户名；新审计记录同样保存账号身份与角色。旧共享账号记录不补造个人身份。

通过部门及相应模块授权的后台账号手机号返回规则：

- 白名单列表/详情可返回完整 `phone` 和 `confirmerPhone`，现场到场列表/详情可返回完整 `phone`；
- 订单列表、订单详情及导出可返回完整 `phone`，同时保留 `phoneMasked` 作为非明文兜底；
- 完整手机号不得下发给公开/H5/screen 接口，也不得写入普通日志和错误响应。

### 4.2 H5

1. `GET /public/activities/{activityCode}` 获取活动公开信息；
2. 用户只输入手机号，调用 `POST /public/activities/{activityCode}/verify-phone`，首次不传 `customerType`；不再预选通道或大区；
3. 后端标准化手机号并计算 HMAC，查询当前活动、当前有效发布版本下的身份。唯一身份直接登录；综合与特渠同号时返回 `selectionRequired:true` 和 `customerTypes:["GENERAL","SPECIAL"]`，不返回客户详情、CSRF 或登录 Cookie，也不创建会话；
4. 弹窗仅展示“综合”“特渠”。选择后向同一接口提交手机号与 `customerType`，后端重新校验当前身份，再在事务内创建会话。成功返回 `selectionRequired:false`、`customer`、`csrfToken`；只在事务提交成功后设置 H5 Cookie；
5. 客户类型、大区、分公司和经销商名称自动从身份记录带出。`regionCode` 作为旧请求兼容字段接受，但不再限制登录、也不改变记录的大区；
6. 会话默认有效期 12 小时（可配置），服务端身份检查仍受活动状态、结束时间、客户启用状态及发布版本约束。只能访问该活动客户的商品和订单。所有验证响应 `Cache-Control:no-store`。

H5 与 API 默认通过同站点托管入口提供。H5 的写请求必须携带 CSRF Header，并校验 `Origin`；Cookie 不放入 URL、`localStorage` 或 `sessionStorage`。若部署为跨站 API，才启用 Bearer 方案，并显式配置 CORS 和凭证撤销。

相同手机号可在综合和特渠分别匹配，不修改原 `(activity_id,data_version_id,customer_type,phone_lookup_hash)` 唯一约束。明确指定类型但未匹配时返回 `WHITELIST_IDENTITY_NOT_FOUND`，不自动切换到另一身份。唯一 `ALL` 身份直接登录。相同类型多重匹配或 `ALL` 与其他类型同时匹配时返回 `WHITELIST_IDENTITY_AMBIGUOUS`，不能取第一条。

活动公开信息中的大区数据继续供展示和看板使用，但 H5 登录不再要求用户选择大区。正常已发布活动不匹配历史名单；缺失或空白名单版本绑定时暂保留旧的跨版本兼容查找，多个同类型匹配仍拒绝。此兼容分支不代表建议新活动绕过白名单发布。

H5 商品展示按当前可见商品目录动态处理返利页签：只有同时存在参与和不参与两种明确返利状态时显示“返利产品”和“非返利产品”，否则显示“全部商品”；返利字段为空的商品属于通用商品，在全部商品或两个筛选页签中均可见。商品说明作为纯文本返回并显示在商品卡片说明区，说明过长时由前端在卡片内部纵向滚动，价格和数量控件不被挤出可视区域。

### 4.3 H5 购物车草稿

验证成功后，H5 使用当前会话访问活动客户自己的草稿：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/h5/activities/{activityCode}/order-draft` | 读取当前活动、当前客户尚未过期的草稿；没有草稿时成功响应可省略 `data` |
| `PUT` | `/h5/activities/{activityCode}/order-draft` | 保存完整购物车快照；需要 CSRF，包含 `customerId`、`baseOrderVersion` 和正数量商品列表 |
| `DELETE` | `/h5/activities/{activityCode}/order-draft?customerId={id}` | 删除当前客户草稿；需要 CSRF |

前端在购物车变化后短暂防抖保存，并在 `pagehide` 时使用 keepalive 尽力提交最后一次快照。刷新、关闭页面或重新验证同一客户后，先加载正式订单和当前商品目录，再恢复版本一致且仍可订的草稿；无效商品不恢复。切换到其他客户前先尽力提交旧客户快照，但新会话始终只能读取新客户自己的草稿。

草稿按 `activityId + activityCustomerId` 唯一隔离，不接受客户端借 `customerId` 操作其他客户。`baseOrderVersion` 与当前订单版本不一致时返回 409 `DRAFT_BASE_ORDER_VERSION_CONFLICT`；商品失效或越权时返回 422。首次正式提交或创建订单变更申请成功后，后端在对应事务中清除草稿；变更申请的审核不会读取草稿。

草稿的 `updatedAt`、`expiresAt` 与其他 API 时间一样返回 ISO 8601 UTC；H5 恢复提示显式使用 `Asia/Shanghai` 格式化，避免数据库、JVM和浏览器重复进行 UTC+8 转换。

## 5. 分页、筛选和排序

- `page` 从 1 开始；
- 默认 `pageSize=50`，允许 20、50、100；订单和审计最大 100；
- 所有排序必须包含唯一 ID 作为最终稳定排序字段；
- 普通列表搜索先标准化输入；后台客户手机号完整 11 位直接按明文字段精确匹配，同时保留 HMAC 索引校验，迁移窗口内对旧密文记录提供只读兼容查询，不把手机号写入日志；
- 所有活动资源 API 都从路径取得 `activityId`，不得只在查询参数中传活动 ID。

## 6. 幂等和并发

审核工作台新增管理员 GET `order-change-requests/page`（status/type/keyword/page/size/newest）、`order-change-requests/pending`（待审核申请 ID 与订单 ID，供数量和订单标记使用）、`order-change-requests/{requestId}`（完整申请及原订单快照）。路径均以 `/admin/activities/{activityId}/` 开头并校验部门范围及 ORDER 权限；分页摘要不包含商品明细。H5 创建申请同时原子替代已有待审核申请，重复幂等键返回原申请。审核通过接口遇到订单版本变化返回成功响应中的 REJECTED 状态，前端必须检查结果状态。

### 6.1 幂等键

以下命令必须携带 `Idempotency-Key`：

- H5 首次提交订单、订单变更申请和撤回申请；
- 确认导入；
- 开始抽奖、完成轮次和重置轮次；
- 创建导出任务。

规则：

- 由客户端为一次用户动作生成 UUID/ULID；
- 同一调用者、接口和幂等键重复请求，载荷一致时返回第一次结果；
- 幂等键相同但载荷不同，返回 409 `IDEMPOTENCY_KEY_REUSED`；
- `PROCESSING` 状态重复请求返回 409/202 并携带可重试提示；
- 订单和抽奖的幂等记录至少保留到活动结束后 30 天；当前不依赖活动归档作为正常生命周期节点。

关键幂等记录、请求指纹、任务 ID 和可重放响应摘要最终保存于 MySQL 的 `api_idempotency`。Redis 可以在命中时加速重复请求和互斥，但缓存丢失、过期或重启后必须回到 MySQL，不得因此重新执行订单版本、导入发布或抽奖结果。

H5 首次提交、纯增量更新及撤回/作废后恢复已实现同次请求复用幂等键及首次成功响应快照。指纹包含 expectedVersion、客户端传入时的 expectedLockVersion、includeHistory 和按 productId 排序的商品/数量；同键异载荷返回 IDEMPOTENCY_KEY_REUSED。已有有效订单的减量、删除商品或撤回使用 `ORDER_CHANGE_REQUEST` 幂等记录，同一申请重复提交返回原申请，不重复创建待审核记录。旧记录缺失快照时返回 IDEMPOTENCY_RESULT_UNAVAILABLE，客户端须查询订单。

前端待确认请求按活动/客户保存在 sessionStorage，恢复窗口 24 小时；每次最多自动重试一次并遵守 Retry-After。服务端只对新 H5 提交快照启用有界清理，至少保留至活动结束和成功提交各满 30 天；PROCESSING、旧格式和其他接口不在此次清理范围。鉴权失败仍拒绝访问。实现与验收见 [H5 幂等重试说明](../testing/h5-idempotency-retry.md)。

### 6.2 乐观锁

- 订单提交请求包含 `expectedVersion`；
- 活动和后台单条编辑使用 `If-Match: "<version>"`；
- 版本不匹配返回 409，不允许后写静默覆盖先写；
- 导入任务和抽奖轮次还使用数据库条件更新状态。

### 6.3 H5性能与兼容参数（2026-09-08）

H5当前订单GET、提交PUT和撤回POST支持可选查询参数`includeHistory`，默认`true`保持历史响应兼容。
设置`false`时只加载当前订单，`versions`与`operations`为空数组，历史数据仍保留并可通过原管理接口查看；当前H5前端使用此模式。

H5写操作按活动共享锁、客户独占锁、幂等/订单记录的顺序执行。不同客户并行，同客户首次提交及草稿/订单竞争被串行化。
商品调价和管理员订单维护保留活动独占锁，截止UPDATE也与共享锁互斥；写事务等待锁后按READ_COMMITTED重查活动状态。
活动状态判断只查询所需状态和时间字段，不在每次下单时组装地区和白名单类型信息。公开活动接口的完整信息不变。

## 7. 文件导入

```text
POST 上传文件 → 202 + taskId
GET 任务 → UPLOADED / PARSING / PREVIEW_READY / CONFIRMING / MATERIALIZING / READY_TO_PUBLISH / PUBLISHING / COMPLETED / FAILED / CANCELLED
GET 预览行和错误 → 管理员编辑/删除预览行
PATCH 预览行集合 + rowIds → 批量删除所选预览行并统一重新校验一次
POST 确认 → CONFIRMING → MATERIALIZING → READY_TO_PUBLISH → PUBLISHING → COMPLETED
```

- 上传限制由配置控制，默认 Excel 50MB、图片 ZIP 1GB、单图片 10MB；
- 服务端校验扩展名、MIME、文件签名和 SHA-256；
- 相同活动、类型和文件哈希的重复上传给出提示，但不擅自覆盖；
- 阻断错误未解决时不能确认；
- 商品和白名单上传后只创建待发布任务及 staging 预览，不改变当前发布版本；每次 Excel 都是独立完整批次，接口不向管理页面提供跨版本新增、更新、未变化或移除状态；
- 白名单 Excel 使用一个非空 Sheet，Sheet 名称不限；第一列必须为客户类型，值只能为综合/特渠或空，且同一文件必须全填或全空；各客户类型的大区均可填写或留空。判重键为有类型时的客户类型 + 标准化经销商全称 + 标准化所属分公司，无类型时的标准化经销商全称 + 标准化所属分公司；手机号按客户类型唯一，综合和特渠之间允许复用；`经销商类型` 不属于新模板必填字段；
- 商品 Excel 统一使用一个非空 Sheet，Sheet 名称不限制；客户类型只允许“综合”“特渠”或空，是否返利只允许“是”“否”或空，物料名称必填，物料代码和产品说明可为空。判重先按客户类型、返利类型和标准化商品名称分组；两行物料代码均有值时，以标准化代码相同判重，代码不同允许；任一代码为空时，同名拦截。图片仍只按标准化商品名称匹配，同名商品行共享图片；产品说明随商品目录保存并由 H5 商品详情展示。
- 商品 Excel 可在确认请求中同时携带本批次图片 ZIP 和 `imageDecisions`。前端逐张提交 `entryPath`、`CONFIRMED/PENDING/UNMATCHED`；`CONFIRMED` 与 `PENDING` 都携带候选 staging 行，`UNMATCHED` 不携带目标。后端校验目标属于当前任务、一个商品名称最多确认一张图且一张最终图片不能绑定不同名称，再把决定保存到导入任务；Worker 按商品名称处理同名商品行，不得重新匹配覆盖。商品预览列表对 `PENDING` 商品的图片列只显示候选图片数量数字；
- 商品图片名称标准化必须保留 Excel 商品名称的完整内容；商品名称中的 `/` 不是文件路径分隔符。ZIP 内部路径单独按归档路径解析，再以文件名和有效路径片段参与匹配。
- 候选图片在商品编辑预览中展示缩略图并提供“选择此图 / 排除候选”。同商品名称命中多张图片时全部为候选，只能选择一张，选择后其余自动排除并同步同名商品行；缺少关系状态的旧预览图片必须降级为候选，不能默认已确认；
- 待确认图片不阻断商品发布。发布时后端将候选文件及其“版本 + 商品名称”关系持久化；管理端通过 `GET /admin/activities/{activityId}/product-image-reviews` 读取当前版本候选，通过 `POST .../{candidateId}/select` 选择或 `DELETE .../{candidateId}` 排除。确认前 H5 不读取候选图；选择后才生成正式 `product_image` 关系；
- 导入预览中的图片编辑同步当前商品名称组，不得根据保留图片遍历或重写其他名称商品；排除结果属于当前 staging 批次决定，确认发布时没有确认目标的图片统一提交为 `UNMATCHED`。重新选择 Excel 时清空客户端待确认 ZIP，新版本不继承上一版本图片；
- 已发布商品编辑同时处理正式单图和当前版本候选。选择候选、排除候选、手工上传替换或删除均须等待后端成功后再关闭编辑框；手工上传会同步同商品名称的当前商品行，并排除该名称所有待确认候选；
- 已发布商品保存基础箱价或阶梯优惠规则后，服务端在同一事务内自动重算当前活动同商品 ID 的 `SUBMITTED` 订单，直接更新当前明细价格、小计和订单总额；不新增订单版本或订单操作记录，订单历史版本保留原提交价格。
- 商品、白名单和现场到场的预览批量删除统一调用集合接口；所选行在同一事务中标记删除，整批完成后只重新校验一次导入任务，不允许前端并发调用多个单行删除请求；
- 三类预览的单行编辑统一通过 `PATCH .../rows/{rowId}` 写入 staging。前端必须具备当前任务 ID 与 staging 行 ID，等待更新及重新校验成功后才关闭编辑抽屉；失败时保留表单内容，不允许降级为仅修改浏览器内存；重新读取预览时以 `editedData` 覆盖原非敏感字段；
- 解析和预览只写 staging；当前由 Spring Boot 应用内任务执行器准备并发布数据，生产环境可拆为独立 Worker；发布事务失败时不得留下半批有效数据；
- 发布事务失败时当前目录保持不变，旧版本可以审计或回滚；
- 活动开始后默认禁止 Excel 全量导入和图片 ZIP 批量导入。

### 7.1 现场到场全量替换与关联

- 每次发布现场到场 Excel 都创建新的完整 `ATTENDANCE` 版本，当前列表不合并或继承上一版本记录及关联；
- Excel 解析完成后调用 `GET /admin/activities/{activityId}/imports/{taskId}/attendance-match-preview`，由后端以当前已发布白名单实时试算每条记录，不显示笼统的“导入后重算”；试算接口只读，但预览编辑会持久化到 staging，二者都不提前写正式到场版本；
- 试算返回当前 `whitelistVersionId`、已关联记录数、按 `activity_customer.id` 去重后的资格客户数、待确认数、未关联数及逐行原因。编辑或删除到场预览行后必须重新试算；白名单发布成功后，仍存在的到场预览也必须刷新试算；
- 管理端把确认入口放在到场预览列表及分页下方，与商品、白名单导入一致；按钮前展示关联摘要并进行二次确认。`PENDING_CONFIRMATION` 与 `UNMATCHED` 不阻断名单发布，只是不进入抽奖候选池；只有 staging 阻断错误、空预览、活动锁定、试算未完成或正在发布时禁用按钮；
- 确认到场导入时必须回传该 `whitelistVersionId`。确认入口和发布 Worker 都重新比较当前白名单版本；若发生变化，返回 409 `ATTENDANCE_WHITELIST_VERSION_CHANGED`，管理员刷新试算后再提交；
- 后端先按参会人员类型限定客户通道；现场填写分公司时，优先按“客户类型 + 分公司 + 经销商全称”唯一精确匹配，再按“客户类型 + 分公司 + 经销商简称”唯一精确匹配，不做跨分公司回退或模糊匹配。分公司为空时仅兼容唯一的客户类型 + 经销商全称匹配；现场手机号只作为联系信息保存，不参与客户身份关联；
- 响应返回 `matchStatus`、`matchMethod`、`matchReasonCode`、`matchedDealerName` 和 `lotteryEligible`；
- `matchStatus` 只有 `MATCHED`、`PENDING_CONFIRMATION`、`UNMATCHED`；当前列表可按状态筛选；
- 全称与简称指向不同客户或名称存在多个候选时返回 `PENDING_CONFIRMATION`，不能静默选择第一条；没有唯一名称候选时返回 `UNMATCHED`；
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
- 商品属于活动、客户类型匹配（商品客户类型为空时按通用商品处理）、当前可见且 `isOrderable=true`；缺少物料代码或吨箱转换系数不影响可订，缺少有效元/箱时必须拒绝加入订单；
- 分公司定制范围匹配；
- 数量为正整数且不超过配置上限；
- 至少有一条有效商品；
- 金额全部由后端计算；吨数在转换系数完整时由后端计算，任一明细无法换算时订单总吨数返回 `null`，不能返回部分合计。

商品价格发生变化时，商品 PATCH 成功保存后自动执行当前订单价格同步：每张订单独立按该商品箱数判断阶梯门槛，只更新 `order_item` 的当前价格字段、明细金额和 `customer_order.total_amount`，不修改数量、吨数、当前版本号或 `order_operation`。看板、排行、战报、H5 和当前订单导出读取更新后的金额；历史 `order_version_item` 仍表示提交时价格。商品价格保存接口不需要额外的预览、确认或同步请求。

商品吨箱转换系数发生变化时，商品 PATCH 成功保存后自动执行当前订单吨数同步：只处理当前活动中状态为 `SUBMITTED` 的订单，按当前明细箱数除以新吨箱系数重算 `order_item.line_tons`，并重新汇总 `customer_order.total_tons`，同时保存新的 `order_item.ton_case_factor`。系数为空时对应明细吨数为空；任一明细无法换算时整单总吨数为空。该同步不改变金额、数量、订单状态、订单版本、订单操作记录和历史 `order_version_item`，不需要额外的预览、确认或同步请求。

撤回不会删除当前明细或创建空版本。重新提交沿用原订单号，并生成下一个版本号。

## 9. 看板和 SSE

看板查询只读取：当前活动、`SUBMITTED` 订单、当前明细。已撤回订单完全排除。

公开排行响应中的 `totals.total_tons`、公司 `tons` 和分公司 `tons` 累计当前筛选范围内有效明细的可计算吨数。它与订单资源的整单 `totalTons` 口径有意不同：订单只要有一条明细无法换算，整单 `totalTons` 仍为 `null`；排行继续累计其余可换算明细。顶部总计没有任何可换算明细时返回 0；无可计算吨数的订单不进入吨数榜，有效零吨仍可参与。

当前SSE示例（`invalidate`要求重新读取活动快照）：

```text
event: invalidate
data: {"scope":"ACTIVITY","activityId":12,"version":938201,"eventCount":1200,"eventType":"ORDER_SUBMITTED","aggregateId":"最后一条事件的对象ID","oldestEventAt":"2026-09-08T05:00:00Z"}
```

当前实现支持：

- `connected`：连接建立时发送；
- `invalidate`：活动内变更合并后的快照失效通知。

每500ms有界读取最多8批、每批1000条已提交且到期的事件，按活动合并通知，再按实际选中的ID分批更新发布状态。
`eventType`/`aggregateId`保留最后一条事件的信息用于兼容；客户端不得按它们过滤本批其他变化。`version`不是可跳过历史的全局水位，较小ID可能晚提交；不能按版本倒退丢弃通知。
不提供Last-Event-ID重放。浏览器每次open后重新获取快照，15秒轮询兜底；同一页面刷新请求串行，积压通知合并为一次后续刷新。历史页面不建立SSE。
数据库确认失败允许重复invalidate，不承诺通知恰好一次。没有连接的情况下仍处理队列，客户端重新连接时依靠快照恢复。
当前为单后端发布器；多副本需要独立广播/订阅设计，不能把此实现视为跨实例可靠广播。SSE中不发送手机号、订单明细或管理员信息。

## 10. 抽奖 API 规则

- 候选主体是 `activity_customer`，即经销商活动身份；
- 同一轮通过数据库唯一约束去重；
- `VALID_ORDERS` 读取正式开奖时当前状态为 `SUBMITTED` 且满足最低金额的订单；
- 每轮的 `probabilityMode` 可为 `EQUAL` 或 `ORDER_AMOUNT_WEIGHTED`；不勾选时当前候选客户等概率，勾选时按开奖前当前 `SUBMITTED` 订单的 `customer_order.total_amount` 占候选有效订单金额总和的比例计算；金额为 0 或没有当前有效订单的客户不进入加权池；
- 新建轮次默认使用 `ORDER_AMOUNT_WEIGHTED`，历史迁移数据使用 `EQUAL` 保持原行为；已开始轮次的概率模式与其他轮次配置一起锁定；
- 三种候选范围统一按 `activity_customer.id` 去重，名称只用于展示；
- 管理端候选预览与正式开奖复用同一套后端查询，预览结果标注试算时间，正式结果以开奖时固定快照为准；
- 管理端候选预览返回当前候选人的理论概率，页面保留两位小数；现场抽奖大屏不展示概率；
- 抽奖严格按轮次执行；候选少于配置中奖人数时全部中奖并记录空缺名额，候选为零时拒绝开奖；
- `ATTENDEES` 至少存在一条有效到场记录，并按活动客户 ID 去重；
- 第一轮不排除已中奖客户；第二轮起仅在该轮启用排除规则时，按 `activity_customer.id` 排除本活动已有 `VALID` 中奖记录；
- 后端使用密码学安全随机数，不接受前端提供随机结果；
- 金额加权的多奖项抽取不重复选择，每抽出一名后按剩余候选人的订单金额重新计算；管理员在截止后、开奖前将订单调整为 `SUBMITTED` 的最新金额计入本次抽奖；
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
| 404 | `PHONE_NOT_IN_WHITELIST` | 手机号未匹配当前客户类型模式的白名单 |
| 409 | `CUSTOMER_CHANNEL_MISMATCH` | 选择通道与白名单身份不一致 |
| 409 | `WHITELIST_MODE_MISMATCH` | 当前白名单要求有类型通道或不区分类型直入，与请求模式不一致 |
| 409 | `ACTIVITY_NOT_OPEN` | 活动未开始 |
| 409 | `ACTIVITY_CLOSED` | 活动已截止或整场已结束 |
| 409 | `ORDER_VERSION_CONFLICT` | 订单已被其他请求更新 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 幂等键被不同载荷复用 |
| 409 | `IDEMPOTENCY_RESULT_UNAVAILABLE` | 历史请求已成功但缺少原响应快照，加载最新订单核对 |
| 409 | `IMPORT_HAS_BLOCKING_ERRORS` | 导入存在未处理阻断错误 |
| 409 | `IMPORT_STATE_CONFLICT` | 导入任务状态不允许该操作 |
| 400 | `IMAGE_DECISION_MULTIPLE_PRODUCTS` | 一张图片确认给了多个不同商品名称 |
| 400 | `IMAGE_DECISION_MULTIPLE_IMAGES` | 同一商品名称确认了多张图片 |
| 409 | `LOTTERY_ROUND_STATE_CONFLICT` | 轮次状态不允许执行 |
| 422 | `LOTTERY_CANDIDATES_EMPTY` | 当前没有符合条件的候选客户 |
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

- 三类后台账号统一登录、退出、当前身份及权限；仅超级管理员自行改密；部门与账号管理、成员创建/授权/重置密码/启停；
- 活动列表、创建、编辑、状态迁移和二维码；
- 商品、白名单、到场名单列表与单条紧急编辑；
- 导入上传、预览、错误、确认和取消；
- 订单列表、详情、版本、操作记录、搜索、筛选和导出；活动开始后管理员可创建、调整、恢复或逻辑作废订单，写操作必须携带幂等键并填写原因；
- 商品价格或阶梯优惠修改后，相关有效订单自动更新当前价格和金额；该价格同步不增加订单版本或订单操作记录。
- 抽奖规则、轮次、发布、执行、完成、重置和中奖导出；
- 审计日志和导出任务。

### 12.3 大屏

- 排行四维组合查询 `/screen/activities/{activityCode}/ranking`，客户类型/大区/项目组单选、品种多选，金额和吨数排行均保留；进入仅请求 `/ranking/options`，确认条件后统计，手动刷新沿用最后成功条件；
- 九类专题战报快照；
- 抽奖轮次和已保存结果；
- 活动级 SSE 事件流。

完整路径、参数和核心 Schema 见 OpenAPI 文件。

排行参数 `customerType=ALL` 表示全部客户，包括内部类型为 `ALL` 的不区分类型客户。大区、项目组、品种按实际字段选择，空值分别使用 `regionUnassigned`、`productLineUnassigned`、`includeUnspecifiedVariety`；“其他”与“ALL”等实际名称仍是普通值。品种通过重复 `varieties` 参数传入，名称中的逗号不拆分。项目组和品种须命中同一条有效商品明细，金额和吨数仅累计命中商品，不取该客户整单金额。顶部总计不受公司/分公司 TopN 限制。订单综合看板的 TOP15 保持原 `/dashboard` 查询。

大量品种导致编码后的筛选串超过 6000 字符时，前端自动改用同路径 `POST /ranking`，JSON 字段与 GET 参数相同；这是只读查询，避免代理和服务端 URL 长度上限，仍受最多 500 品种和单值长度校验。

客户和大区依据当前有效订单身份快照，商品维度依据当前有效明细；选项额外包含当前已发布白名单/商品目录中尚未下单的实际配置。更改白名单或目录名称不追溯改写已生效订单的身份和商品快照。FINISHED 维护后更新完整筛选快照，ARCHIVED 保持冻结；旧历史首次确认时核对保留订单和旧冻结总计及已保存排行，不一致返回 `RANKING_HISTORY_MISMATCH`。

活动进行中，商品条件确认后按当前有效明细计算，不维护新的订单/项目组/品种实时汇总。未选商品条件时继续使用订单头金额和原整单吨数汇总优化。原项目组汇总继续服务既有看板。选项查询只提取实际维度，不计算金额或吨数；V044 仅新增历史冻结基础。
