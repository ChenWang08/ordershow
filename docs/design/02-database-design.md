# 订购会系统数据库设计

## 1. 设计原则

- MySQL 是订单、抽奖和审计的唯一事实来源；
- 所有活动业务表显式包含或可通过父记录唯一追溯到 `activity_id`；
- 多场活动数据永久保留，新导入不得覆盖历史活动；
- 当前数据与历史快照分离，基础资料修改不改变历史订单；
- 金额使用定点小数，禁止使用 FLOAT/DOUBLE；
- 业务页面删除当前版本数据；数据库内部可使用可见标记或删除时间保护历史引用，订单版本、中奖结果和审计日志不可物理删除；
- 数据库唯一约束是并发一致性的最后防线，不能只依赖 Redis；
- 时间字段使用 `DATETIME(3)` 保存 UTC 时间点，展示时按活动时区转换。

## 2. 标识策略

- 内部主键：`BIGINT UNSIGNED AUTO_INCREMENT`；
- 活动公开标识：不可变且唯一的 `activity_code`，用于二维码和 URL；
- 订单公开标识：唯一 `order_no`，首次提交生成，版本变化时不改变；
- 导入、导出、抽奖等资源对外 API 不直接暴露可枚举信息时，可在应用层增加 ULID；第一期后台鉴权资源允许使用数字 ID。

## 3. 手机号保护

活动客户表不保存可直接查询的手机号明文：

| 字段 | 用途 |
| --- | --- |
| `phone_ciphertext` | AES-GCM 等应用层加密后的原始标准化手机号，授权查看/导出时解密 |
| `phone_lookup_hash` | `HMAC-SHA-256(environment_secret, normalized_phone)`，用于精确匹配；唯一约束另组合活动、数据版本和客户类型 |
| `phone_masked` | H5、订单、排行、战报、抽奖大屏和日志等非明文场景展示，例如 `138****1234` |
| `phone_key_version` | 支持将来轮换加密密钥 |

由于采用 HMAC 精确查询，手机号搜索默认是完整手机号精确搜索；如未来必须支持任意片段模糊查询，需要新增专用受控搜索索引，不能退化为所有场景保存明文。已登录管理员访问白名单和现场到场管理接口时，后端可按权限解密并返回完整 `phone`；白名单同时可返回完整 `confirmerPhone`。这些字段不得进入公开/H5/订单/大屏接口、缓存、普通日志或审计载荷。

## 4. 数据域与表

### 4.1 管理员

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `admin_user` | 多个独立管理员账号 | 用户名唯一；一期角色固定 `ADMIN` |
| `admin_session` | 管理员登录会话 | 只保存令牌哈希；支持撤销 |

管理员不能共享账号。业务审计通过管理员 ID 追踪到具体人员。

### 4.2 活动

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `activity` | 活动名称、编号、时间、状态和展示配置 | 活动编号唯一；开始时间早于截止时间 |

活动状态：`DRAFT`、`SCHEDULED`、`ACTIVE`、`CLOSED`、`ARCHIVED`。草稿活动可以时间重叠；已发布且未截止活动通过服务层校验禁止重叠，以保证通用 H5 入口只能解析到一场活动。

### 4.3 文件、导入和导出

| 表 | 作用 |
| --- | --- |
| `stored_file` | 对象存储文件元数据 |
| `import_task` | Excel/ZIP 导入批次、统计及图片人工匹配决定 |
| `import_staging_row` | 解析预览、校验状态、人工编辑结果 |
| `import_publish_version` | 已校验、可发布的不可变数据集版本、摘要和来源任务 |
| `activity_data_binding` | 活动 + 数据类型当前生效版本指针 |
| `import_error` | 定位到 Sheet、行、字段的错误 |
| `export_task` | 后台异步导出任务 |

Excel 解析、标准化、校验和人工编辑只写入 staging，不修改当前商品/白名单。商品和白名单每次均按独立完整批次预览，不计算跨版本新增、更新、未变化或移除。确认后由当前 Spring Boot 应用内任务执行器将 staging 物化为不可变的 `import_publish_version` 及其版本化商品/客户行；生产环境拆分独立 Worker 后承接同一职责。最终发布事务只锁定活动 + 数据类型，校验基础数据版本和任务状态，并切换 `activity_data_binding` 的当前版本指针，同时写审计和 outbox。读请求只能读取当前指针对应的版本，因此不会看到半批数据。

版本化商品/客户行可以使用独立版本表，也可以在现有领域表增加 `data_version_id`；物理实现不同不影响契约：所有当前查询必须先解析当前指针，再限定到同一个发布版本，不能混读旧版本和新版本。

旧版本在保留期内不删除，可用于审计和回滚；已有订单只读取下单时快照，不受后续版本切换或当前目录删除影响。`import_task` 和 `export_task` 同时承担 DB Task Queue 记录，必须保存状态、租约、尝试次数、下次重试时间和最后错误摘要。现场到场任务确认时把实时试算所依据的白名单发布版本保存到 `import_task.match_base_version_id`，确认入口和 Worker 发布前均校验该版本仍为当前白名单，防止预览与发布之间发生基础数据漂移。

白名单和到场名单的预览行可能包含手机号。此类原始/编辑载荷写入 `sensitive_data_ciphertext`，普通 JSON 只保留脱敏预览；`import_error.raw_value_masked` 同样不得保存手机号明文。导入任务完成并超过排障保留期后，可以清理预览密文，但原始文件仍按受控对象存储策略保留。

### 4.4 客户和商品

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `customer` | 跨活动永久经销商身份 | 客户类型 + 标准化全称唯一 |
| `activity_customer` | 当前活动白名单和资料快照 | 活动 + 客户类型 + 手机 HMAC 唯一 |
| `activity_attendee` | 当前活动到场人员及本版本白名单关联结果 | `data_version_id` 限定当前全量版本；`match_status` 为已关联、待确认或未关联 |
| `activity_product` | 当前活动商品目录 | 活动 + 业务键唯一；分别保存是否展示和是否可订 |
| `activity_product_branch_scope` | 分公司定制品允许范围 | 商品 + 标准化分公司唯一 |
| `product_image` | 商品图片历史及当前单图 | 商品 + 文件唯一；新写入规则保证每个物料代码当前最多一张图，旧多图仅作历史兼容 |
| `product_image_review_candidate` | 已发布商品版本尚待人工处理的 ZIP 图片候选 | 版本 + 文件 + 标准化物料代码唯一；状态为待确认、已选择或已排除 |

空物料代码商品使用应用层计算的 `business_key` 唯一识别；数据库同时保存 `material_code` 和 `business_key`，避免 NULL 唯一约束语义导致重复。

每次商品 Excel 与确认时附带的图片 ZIP 形成独立版本。新版本不复制上一版本的 `product_image` 关联，也不继承 `ZIP_IMPORT` 或 `MANUAL` 图片；旧图片关联保留在旧版本供历史订单与审计读取。图片 ZIP 写入 `import_task.auxiliary_file_id`，预览关系写入 `import_task.image_decisions_json`。`CONFIRMED` 关系写入 `product_image`，`PENDING` 关系连同候选文件写入 `product_image_review_candidate`；二者都必须在切换当前版本前完成。待确认候选不属于正式商品图，因此商品可以先发布，H5 继续显示占位图，管理员再从当前版本逐个选择或排除。旧版本候选随版本绑定失效但继续保留供审计。

图片 ZIP 以单张图片为匹配单位。匹配前先校验品种、容量、装箱数、容器材质、瓶型和外包装，明确冲突不自动关联；ZIP 相对路径会参与名称恢复。图片先按名称试算候选，最终按标准化物料代码确认：一个代码只能选一张图，同代码 staging 行共享结果，不同代码不能共用同一张最终图片；同代码名称冲突时阻止确认并要求核对。匹配到多图时商品为“待确认”，选择一张后为“已匹配”并自动排除同代码的其他候选及该文件在其他代码下的候选，全部排除后为“未匹配”。手工上传替换图时也会排除该代码剩余候选。

商品展示与可订分离：已启用且物料名称有效时 `is_visible=true`；仅当元/箱存在且大于 0 时 `is_orderable=true`。物料代码、元/瓶、规格、箱规和吨箱转换系数均可空，不影响展示；吨箱转换系数为空不影响下单。

### 4.5 订单

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `customer_order` | 每个活动客户的唯一当前订单 | 活动 + 活动客户唯一；订单号唯一 |
| `order_item` | 当前版本明细和商品属性快照 | 订单 + 商品唯一 |
| `order_version` | 每次成功非空提交的不可变版本 | 订单 + 版本号唯一 |
| `order_version_item` | 版本商品和客户/商品快照 | 版本 + 行号唯一 |
| `order_operation` | 提交、修改、撤回和重新提交记录 | 只追加 |
| `api_idempotency` | 命令请求的持久幂等记录 | 活动 + 调用者 + 接口 + 幂等键唯一 |
| `h5_order_draft` | H5 未提交购物车草稿 | 活动 + 活动客户唯一；外键同时约束活动和活动客户 |

`api_idempotency` 保存规范化请求指纹、`PROCESSING/COMPLETED/FAILED` 状态、任务 ID 和可重放的响应摘要。关键业务变更与幂等完成状态必须在同一 MySQL 事务内提交；Redis 只缓存已知结果或做快速互斥，不能替代该记录。

`h5_order_draft` 只保存商品 ID 与数量 JSON、草稿所基于的 `base_order_version`、草稿锁版本、更新时间和过期时间，不保存手机号、客户名称、价格或订单金额。保存、读取和删除必须同时满足 H5 会话中的 `activityId` 与 `activityCustomerId`；请求体中的客户 ID 仅作一致性校验，不能改变会话身份。草稿商品每次保存都重新校验当前商品版本、客户类型、分公司范围、可见和可订状态。

草稿不属于正式订单事实：首次提交前可以存在 `h5_order_draft`，但不存在 `customer_order`、订单号和订单版本。草稿 `base_order_version` 必须等于客户当前订单版本，防止旧页面覆盖已经提交或修改的订单；成功提交、幂等重放确认成功或撤回后删除草稿。`expires_at` 不晚于活动截止时间，过期草稿不再恢复。

V010 新增草稿表；V011 将早期受 MySQL `Asia/Shanghai` 会话默认值影响的明显未来时间校正为 UTC。后续草稿写入显式使用 `UTC_TIMESTAMP(3)`，API 返回 ISO 8601 UTC，页面按 `Asia/Shanghai` 展示。

业务状态只有：

- `SUBMITTED`：参加统计和抽奖；
- `WITHDRAWN`：保留最近一次非空明细，但不参加统计和抽奖。

活动 `CLOSED` 或 `ARCHIVED` 后订单只读，不批量改写订单状态。

### 4.6 访问、看板和抽奖

| 表 | 作用 |
| --- | --- |
| `visit_event` | H5 打开、验证成功/失败、查看商品和提交结果事件 |
| `lottery_rule` | 活动抽奖规则组 |
| `lottery_round` | 每一轮配置和执行状态 |
| `lottery_draw_attempt` | 每次实际抽取的不可变规则快照、结果哈希和有效状态 |
| `lottery_candidate_snapshot` | 开始抽奖时固定的经销商候选快照 |
| `lottery_winner` | 永久中奖结果及有效/作废标记 |
| `domain_event_outbox` | 事务提交后可靠触发缓存失效和 SSE 通知 |

看板数据可以缓存在 Redis，不另设当前事实表；缓存丢失时从 `customer_order` 和 `order_item` 重建。

抽奖候选的业务主体始终是 `activity_customer`。当候选范围为 `ATTENDEES` 时，只选取当前到场发布版本中 `match_status=MATCHED`、且仍指向当前有效白名单版本的活动客户，并按 `activity_customer.id` 去重；`PENDING_CONFIRMATION` 和 `UNMATCHED` 不进入候选池。

`activity_attendee.match_method` 新关联仅记录名称精确关联依据：`FULL_NAME`、`SHORT_NAME` 或 `MANUAL`；`PHONE` 仅为兼容历史记录保留，新计算不再产生。现场手机号只作联系信息，不参与客户身份关联。Excel 发布不更新上一版本行，而是创建新版本并重新计算全部关联。白名单版本切换后，当前到场版本也必须在同一发布事务中重新计算，不能保留旧白名单关联。

### 4.7 审计

`audit_log` 记录管理员和系统的敏感操作。审计记录保存变更前后 JSON 摘要、原因、IP、User-Agent 和 trace ID，只追加不更新。

## 5. 精度与计算

| 数据 | 类型 | 规则 |
| --- | --- | --- |
| 元/箱 | `DECIMAL(18,4) NULL` | 保存导入精度；为空时商品可展示但不可订 |
| 明细金额 | `DECIMAL(18,2)` | `箱数 × 元/箱`，HALF_UP 到 2 位 |
| 订单金额 | `DECIMAL(18,2)` | 明细金额求和 |
| 吨箱转换系数 | `DECIMAL(18,8) NULL` | 保存导入精度；为空不阻断展示和下单 |
| 明细/订单吨数 | `DECIMAL(18,6) NULL` | 后端按条件计算；任一明细无法换算时订单总吨数整体为空 |
| 箱数 | `BIGINT UNSIGNED` | 非负整数 |

当前订单明细和订单版本明细都保存下单时价格、可空的转换系数、可空的折算吨数和商品属性快照；订单版本主表保存当时的客户类型、区域、分公司、经销商名称及可空总吨数快照。看板读取当前订单明细快照，历史查询读取版本快照。后端忽略前端提交的金额和吨数；任一明细缺少转换系数时不得生成部分订单总吨数。

## 6. 关键唯一约束

```text
activity.activity_code
customer(customer_type, normalized_dealer_full_name)
activity_customer(activity_id, customer_type, phone_lookup_hash)
activity_customer(activity_id, customer_id)
activity_product(activity_id, business_key)
customer_order(activity_id, activity_customer_id)
customer_order.order_no
order_version(order_id, version_no)
lottery_draw_attempt(round_id, attempt_no)
lottery_candidate_snapshot(draw_attempt_id, activity_customer_id)
lottery_winner(draw_attempt_id, activity_customer_id)
api_idempotency(activity_id, actor_type, actor_id, endpoint_code, idempotency_key)
```

上述商品和活动客户唯一键按“当前发布版本”解释；若物理表同时保留多个版本，数据库唯一索引需把 `data_version_id` 纳入范围，查询再通过 `activity_data_binding` 限定当前版本。订单和历史快照不能依赖当前商品版本回读。

跨轮次是否排除已中奖客户由轮次规则决定：第一轮不排除，第二轮起可按轮次启用。启用时，应用在持有活动抽奖锁后按活动客户 ID 查询同活动有效中奖结果；每次抽取尝试内的唯一约束保证候选和中奖位置不会重复。重置时旧尝试及结果改为 `INVALIDATED`，新抽取使用递增的 `attempt_no`，因此既能保留旧记录也能合法重抽。

## 7. 关键索引

- 活动：状态 + 开始/截止时间；
- 活动客户：活动 + 客户类型 + 状态；活动 + 分公司；手机号 HMAC 唯一索引；
- 商品：活动 + 客户类型 + 状态 + 排序；物料代码；
- 订单：活动 + 状态 + 最后提交时间；活动 + 客户类型 + 区域/分公司；
- 订单版本：订单 + 版本号；
- 导入：活动 + 数据类型 + 创建时间；
- 抽奖轮次：活动 + 状态 + 排序；
- 访问事件：活动 + 事件类型 + 时间；
- 审计：活动 + 时间；操作者 + 时间；对象类型 + 对象 ID。

所有列表使用稳定排序和游标/页码分页，不允许无活动范围扫描核心业务表。

## 8. 数据生命周期

- 活动、订单版本、中奖结果和审计默认长期保留；
- 商品和活动客户可使用 `is_visible/is_active` 与 `deactivated_at` 在底层隐藏已从当前版本删除的数据，这些字段不形成后台“停用记录”功能；
- 原始导入文件、导入错误和导出文件保留期可按公司制度配置；
- 导出文件到期可从对象存储删除，但导出任务元数据和审计保留；
- 商品图片只有在无当前商品、订单快照或其他引用后才允许物理清理；
- 测试环境不得复制正式手机号和正式订单。

## 9. 事务边界

### 9.1 订单提交

1. 校验活动、凭证、商品范围和 `lock_version`；
2. 检查或创建幂等记录；
3. 锁定订单主记录或依赖乐观锁；
4. 后端计算当前明细；
5. 写订单主表、当前明细、新版本和版本明细；
6. 写订单操作和 outbox 事件；
7. 提交事务后缓存结果并通知 SSE。

### 9.2 导入确认

1. 导入任务必须为 `PREVIEW_READY`；
2. 同活动同数据类型只允许一个 `CONFIRMING` 任务；
3. 校验预览无阻断错误；
4. 当前应用内任务执行器在非当前数据集内物化并校验新的发布版本；生产环境拆分后由 Worker 承接；
5. 短事务锁定活动 + 数据类型，检查 `base_version` 未变化后切换当前版本指针；
6. 更新任务统计和状态，写审计和 outbox；
7. 最终发布事务失败时当前版本保持不变；发布后的旧版本可按策略回滚。

### 9.3 抽奖

1. 获取活动/轮次 Redis 锁；
2. 数据库条件更新轮次 `READY → DRAWING`；
3. 在事务内生成候选快照和安全随机结果；
4. 写中奖记录并把轮次变为 `DRAWN`；
5. 写审计和 outbox 后提交；
6. 提交成功后现场页面才允许揭晓。

## 10. ER 图与脚本

- ER 图：`diagrams/database-er.mmd`
- 完整建表：`../../db/schema.sql`
- 初始迁移：`../../db/migrations/V001__initial_schema.sql`

建表脚本是逻辑基线。进入正式编码时由 Flyway 管理迁移；已执行的迁移文件不可修改，只能追加新版本。
