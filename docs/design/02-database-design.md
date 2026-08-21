# 订购会系统数据库设计

## 1. 设计原则

- MySQL 是订单、抽奖和审计的唯一事实来源；
- 所有活动业务表显式包含或可通过父记录唯一追溯到 `activity_id`；
- 多场活动数据永久保留，新导入不得覆盖历史活动；
- 当前数据与历史快照分离，基础资料修改不改变历史订单；
- 金额使用定点小数，禁止使用 FLOAT/DOUBLE；
- 业务删除使用状态或停用时间，订单版本、中奖结果和审计日志不可物理删除；
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
| `phone_lookup_hash` | `HMAC-SHA-256(environment_secret, customer_type + ':' + normalized_phone)`，用于精确匹配和唯一约束 |
| `phone_masked` | 页面普通展示，例如 `138****1234` |
| `phone_key_version` | 支持将来轮换加密密钥 |

由于采用 HMAC 精确查询，手机号搜索默认是完整手机号精确搜索；如未来必须支持任意片段模糊查询，需要新增专用受控搜索索引，不能退化为所有场景保存明文。

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
| `activity` | 活动名称、编码、时间、状态和展示配置 | 活动编码唯一；开始时间早于截止时间 |

活动状态：`DRAFT`、`SCHEDULED`、`ACTIVE`、`CLOSED`、`ARCHIVED`。活动可以时间重叠，每个入口通过活动编码独立访问。

### 4.3 文件、导入和导出

| 表 | 作用 |
| --- | --- |
| `stored_file` | 对象存储文件元数据 |
| `import_task` | Excel/ZIP 导入批次和统计 |
| `import_staging_row` | 解析预览、差异类型、人工编辑结果 |
| `import_error` | 定位到 Sheet、行、字段的错误 |
| `export_task` | 后台异步导出任务 |

确认导入遵循全量替换规则：在一个事务内更新或插入本批记录，并停用本批文件中不存在的当前记录。已有订单只读取快照，不受停用影响。

白名单和到场名单的预览行可能包含手机号。此类原始/编辑载荷写入 `sensitive_data_ciphertext`，普通 JSON 只保留脱敏预览；`import_error.raw_value_masked` 同样不得保存手机号明文。导入任务完成并超过排障保留期后，可以清理预览密文，但原始文件仍按受控对象存储策略保留。

### 4.4 客户和商品

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `customer` | 跨活动永久经销商身份 | 客户类型 + 标准化全称唯一 |
| `activity_customer` | 当前活动白名单和资料快照 | 活动 + 客户类型 + 手机 HMAC 唯一 |
| `activity_attendee` | 当前活动到场人员 | 可多参会人关联同一经销商 |
| `activity_product` | 当前活动可下单商品 | 活动 + 客户类型 + 返利状态 + 物料代码唯一 |
| `activity_product_branch_scope` | 分公司定制品允许范围 | 商品 + 标准化分公司唯一 |
| `product_image` | 商品图片及主图顺序 | 商品 + 文件唯一；每商品只允许一个主图由应用层维护 |

空物料代码商品使用应用层计算的 `business_key` 唯一识别；数据库同时保存 `material_code` 和 `business_key`，避免 NULL 唯一约束语义导致重复。

### 4.5 订单

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `customer_order` | 每个活动客户的唯一当前订单 | 活动 + 活动客户唯一；订单号唯一 |
| `order_item` | 当前版本明细和商品属性快照 | 订单 + 商品唯一 |
| `order_version` | 每次成功非空提交的不可变版本 | 订单 + 版本号唯一 |
| `order_version_item` | 版本商品和客户/商品快照 | 版本 + 行号唯一 |
| `order_operation` | 提交、修改、撤回和重新提交记录 | 只追加 |
| `api_idempotency` | 命令请求的持久幂等记录 | 活动 + 调用者 + 接口 + 幂等键唯一 |

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

### 4.7 审计

`audit_log` 记录管理员和系统的敏感操作。审计记录保存变更前后 JSON 摘要、原因、IP、User-Agent 和 trace ID，只追加不更新。

## 5. 精度与计算

| 数据 | 类型 | 规则 |
| --- | --- | --- |
| 元/箱 | `DECIMAL(18,4)` | 保存导入精度 |
| 明细金额 | `DECIMAL(18,2)` | `箱数 × 元/箱`，HALF_UP 到 2 位 |
| 订单金额 | `DECIMAL(18,2)` | 明细金额求和 |
| 吨箱转换系数 | `DECIMAL(18,8)` | 保存导入精度 |
| 明细/订单吨数 | `DECIMAL(18,6)` | 后端计算并保存，默认展示 4 位 |
| 箱数 | `BIGINT UNSIGNED` | 非负整数 |

当前订单明细和订单版本明细都保存下单时价格、转换系数、商品属性快照；订单版本主表保存当时的客户类型、区域、分公司和经销商名称快照。看板读取当前订单明细快照，历史查询读取版本快照。后端忽略前端提交的金额和吨数。

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

跨轮次是否排除已中奖客户由轮次规则决定。默认排除时，应用在持有活动抽奖锁后查询同活动有效中奖结果；每次抽取尝试内的唯一约束保证候选和中奖位置不会重复。重置时旧尝试及结果改为 `INVALIDATED`，新抽取使用递增的 `attempt_no`，因此既能保留旧记录也能合法重抽。

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
- 商品和活动客户使用 `is_active` 与 `deactivated_at` 停用；
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
4. 更新/新增当前记录，停用本批缺失记录；
5. 更新任务统计和状态；
6. 写审计和 outbox；
7. 任一步骤失败整批回滚。

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
