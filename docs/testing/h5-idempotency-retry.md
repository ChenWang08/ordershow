# H5 提交幂等重试（2026-09-21）

范围：H5 PUT order 的首次提交、修改与撤回后重提。源码实现使用现有数据库结构；本机已经先更新后端再更新前端，详见 [部署记录](../deployment/2026-09-21-h5-idempotency.md)。

## 客户端

一次提交保存活动代码、客户 ID、UUID、创建时间、expectedVersion 和按 productId 排序的商品/数量。自动或手动重试发送同一键及同一请求体。每次操作最多自动重试一次，覆盖网络异常、20 秒客户端超时、5xx、408、429 和 REQUEST_IN_PROGRESS；等待至少一秒并遵守 Retry-After，超过 10 秒的等待交给手动重试。客户端超时不表示服务端回滚。

sessionStorage 按活动和客户隔离，待确认请求保留 24 小时；刷新后重新验证同一客户时尝试恢复原提交。浏览器拒绝存储时仍保留内存重试，但刷新恢复不可用。记录损坏或过期时要求先加载最新订单，禁止静默生成新键重发旧请求。成功清除待确认记录；确定的业务错误不自动重试，版本冲突要求重新核对。用户修改请求内容前必须先确认原提交结果，基于新版本提交生成新键。

## 数据库和重放

新前端同时发送 X-H5-Customer-Id，后端对照已认证客户校验，防止另一个页签切换共享 Cookie 后把原提交写给新客户；不匹配返回 403 H5_CUSTOMER_CHANGED。历史客户端可省略该头，仍按原鉴权处理。

沿用唯一键 `(activity_id,actor_type,actor_id,endpoint_code,idempotency_key)` 和活动共享锁→客户独占锁→幂等记录的锁顺序。同 key 并发请求被事务协调；首次失败回滚后，后续相同请求可以接管执行。

H5_SUBMIT 指纹使用固定 UTF-8 格式 `H5_ORDER_SUBMIT_V1`、expectedVersion、includeHistory，以及按 productId 排序的 productId:quantity，计算 SHA-256。JSON 属性顺序与商品列表顺序不影响指纹；实际订单行顺序仍按商品目录排序。重复 productId、非法数量先拒绝，不合并重复项。

新记录 response_json 格式为 `{format:2,orderId,orderVersion,resultJson}`。resultJson 是首次成功 OrderView 的 JSON 字符串，保留 BigDecimal 精度，避免 MySQL JSON 数值转换影响金额。订单、版本、操作轨迹、outbox、草稿清除及幂等快照在同一事务提交。重试返回该结果快照，HTTP envelope 的 traceId 仍属于本次请求。

成功重放不执行订单写入、不清草稿、不生成操作轨迹/outbox，也不重复记录成功请求审计。普通请求审计仍由现有拦截器写入，不能将其描述为与订单同事务的业务记录。

在身份验证与客户锁之后、活动可写检查之前识别成功重放。订货截止后的已认证客户可回放原结果；身份撤销、活动归档、整场结束导致会话不再有效等情况仍受现有鉴权约束，保留快照不等于授权访问。

旧记录只有 orderId，无法还原确切首次响应；验证旧指纹后返回 409 IDEMPOTENCY_RESULT_UNAVAILABLE，提示查询订单，不重新执行，也不冒充原快照。新记录同键异载荷返回 IDEMPOTENCY_KEY_REUSED。

## 保留和清理

新 H5 提交记录 expires_at 为 max(创建时刻,活动 event_ends_at/ends_at)+30 天。每小时最多删除 500 条已完成、format=2 的 H5 ORDER_SUBMIT 记录，且必须同时满足 expires_at 已到、成功已超过 30 天、活动状态为 CLOSED/FINISHED/ARCHIVED、当前活动结束时间已超过 30 天。活动延期仍受当前结束时间检查保护。

不清理 PROCESSING、其他接口或历史格式记录。其他接口及历史记录的保留策略继续独立管理。时间字段表示最早可清理时间；记录仍在时继续回放，实际删除后的无限期重放不属于保证范围。前端 24 小时恢复窗口早于服务端最低保留期。

## 验证

- 前端 h5-submission.test.mjs：响应丢失、503/Retry-After、重载恢复、不同活动/客户隔离、同键并发点击、内容变化、版本冲突、恢复过期。
- H5SubmitFingerprintTest：JSON/商品顺序等价，版本、数量和响应模式差异。
- H5IdempotencyPersistenceTest：隔离 MySQL 连接私有临时表验证提交前回滚、快照回放、不同载荷拒绝、旧记录兼容及每批 500 条清理保护。
- IsolatedApiE2ETest：四路相同键并发提交，返回同一完整 V1；修改到 V2 后重放 V1 保留新草稿和当前 V2；订货截止后回放 V1，新的提交仍被拒绝。
- H5WriteAdmissionFilterTest：准入超时返回 503 且不调用业务链；过滤器在安全/CORS 处理之后执行，CORS 暴露 Retry-After。

这些用例覆盖 API 与状态逻辑；手机浏览器视觉验收和新增响应快照后的容量压测另行进行。

2026-09-21 执行结果：完整前端回归 103 项通过；最终 H5 提交专项 10 项通过（包含后来增加的 HTTP 活动/客户绑定用例）。完整后端回归统计 124 项，119 项通过、5 项因缺少独立 ORDER_SHOW_LOAD 环境按条件跳过；包含全部 10 项隔离 API E2E 及新增真实 MySQL 持久化/清理测试。后续客户绑定控制器与 OpenAPI 契约专项 2 项通过。最终类型检查、lint 和前后端镜像构建通过。
