# H5 写请求保护与刷新按钮（2026-11-05）

本轮仅实现等待人数上限、小尺寸刷新按钮、活动＋客户写限频及必要的提示/重试兼容。未部署业务服务、重启容器或向线上发送业务请求。

## 行为与配置

### 每实例等待人数

- 原有同时处理默认值仍为 36，最长等待仍为 12000ms；新增 `H5_WRITE_MAX_WAITERS=50`。
- 36 个处理名额及 50 个等待名额占满时，新请求直接返回既有 `503 H5_WRITE_BUSY`，带 `Retry-After: 1`。等待超时同样返回该响应。
- 沿用原过滤范围：H5 order、order/withdraw、order-draft、order-change-requests 的写请求；查询和后台接口不新增排队限制。
- 这些数量按实例计算，等待区不持久化订单，也不承诺自动补交。客户端仍沿用原幂等重试。
- 代码和 Compose 的并发默认值为 36；`.env.example` 原有本地覆盖值 12 保留，部署时应核对实际环境变量，不能把默认值当成线上实测配置。

### 手动刷新

- 仅在“我的订单”状态卡片右上角增加 `↻ 刷新状态`，可见按钮约 90×30px，点击区域至少 44px 高。
- 沿用 `useH5OrderSync` 的 15 秒窗口，起点是最近一次普通读取或已确认的同步结果；在途查询共享，不叠加请求。
- 正常刷新仅查询原有订单和当前申请接口，最多两次读取。倒计时只更新文字，静置不新增查询；修改/撤回前的必要检查仍按原规则执行。
- 查询失败保留已显示数据，提交和恢复结果待确认时禁用该按钮。成功页不新增按钮。

### 活动＋客户写限频

使用已认证身份中的活动 ID 和客户 ID，共享提交、修改申请、撤回申请的额度；保留旧撤回入口的兼容保护。草稿、查询、后台操作不纳入个人写限频。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `H5_CUSTOMER_WRITE_RATE_LIMIT_ENABLED` | `true` | 关闭后跳过新增的 Redis 检查和回执读取 |
| `H5_CUSTOMER_WRITE_WINDOW_MS` | `10000` | 滚动时间窗口 |
| `H5_CUSTOMER_WRITE_MAX_OPERATIONS` | `3` | 窗口内最多 3 个不同的新操作，按放行的操作计数，业务失败也可能占用额度 |
| `H5_CUSTOMER_WRITE_MAX_REQUESTS` | `20` | 所有请求含幂等重试的宽松防刷上限，不会因重复键而无限放行 |
| `H5_CUSTOMER_WRITE_REDIS_BUDGET_MS` | `200` | 调用方等待限频检查的时间预算，包含检查任务排队 |
| `H5_CUSTOMER_WRITE_REDIS_RECOVERY_MS` | `5000` | Redis 异常/超时后暂停个人检查的时间 |

10 秒/3 次和 200ms 是待部署验证的初始配置，尚无本轮真实 Redis 延迟和容量测试依据。

- 复用现有 `StringRedisTemplate`，不调整 Redis 连接池、全局超时或数据库连接池。所有副本需使用同一 Redis 数据库和键空间。
- Lua 在 Redis 内原子执行，使用 Redis 时间；每个活动＋客户的短期集合和指纹自动过期，无轮询和限频数据库写入。
- 先通过现有唯一索引只读取幂等回执的请求指纹/格式，以识别超过 Redis 窗口的旧重试。每个受保护请求因此会新增一次短数据库读取；原有事务内幂等校验仍负责最终正确性。
- 同一键同一内容的重试不重复占用 3 次新操作额度；同键不同内容仍返回 `IDEMPOTENCY_KEY_REUSED`。新键不能伪装成重试绕过额度。
- 超限返回 `429 H5_WRITE_RATE_LIMITED` 和向上取整的 `Retry-After`，不调用订单写服务。
- Redis 检查最多 4 个执行任务和 32 个等待任务；超时取消尚未发送的任务。已开始的调用可能继续由原客户端完成，调用方不继续等待；异常时暂时放行个人检查，原有全局 36/50 保护继续工作。此降级不代表业务使用 Redis 的其他功能也能抵御故障。
- 指标 `order_show.h5.customer_write` 按 allowed/limited/replay/degraded 分类，不使用客户 ID 作为指标标签。
- 前端只对首次命令的明确限频清除待确认记录，保留购物车并显示提示；此前结果不确定或从存储恢复的命令继续使用原键/原请求体，防止重新生成请求导致重复业务操作。

## 本轮验证

- 前端 45 项通过：刷新按钮、15 秒边界、静置不读取、查询合并/失败保留、首次限频后购物车可编辑、响应丢失后保留原命令等。
- 后端 23 项通过：实际 36 处理＋50 等待边界、第 87 个请求及时拒绝、超时/异常释放、身份与接口接入、回执指纹兼容、429/Retry-After、Redis 异常与有界检查任务等。Redis Store、回执数据库读取使用替身，未把它们当成真实多实例验证。
- 修改文件 ESLint、TypeScript 类型检查和 `git diff --check` 通过。
- 合成 HTTP 的真实 H5 浏览器检查通过：320/390/1440px，按钮尺寸和位置、15 秒倒计时、静置无查询及原编辑流程；浏览器脚本拦截所有业务请求，不连接线上或真实后端。
- 本地证据在忽略目录：`outputs/h5-protection-front-tests.log`、`outputs/h5-protection-backend-tests.log`、`outputs/h5-protection-browser-tests.log`，截图 `outputs/h5-manual-refresh/pending-*.png`。

前端定向命令：

```sh
node --test tests/h5-refresh-button.test.mjs tests/h5-manual-refresh.test.mjs tests/h5-submitted-view.test.mjs tests/h5-submission.test.mjs
```

后端定向选择：`H5WriteAdmissionFilterTest,H5CustomerWriteRateLimiterTest,H5CustomerWriteGuardTest,H5ReceiptLookupTest,H5SubmissionIdentityTest,OrderSummaryHttpTest,H5SubmitFingerprintTest`。

## ACK 部署配置

- 本轮配置示例增加在 `.env.example`，未修改真实 `.env`。ACK 不会因为镜像更新而自动读取本地 `.env.example` 或 Compose 配置。
- 新增参数在代码中均有默认值，部署团队无需逐项新增环境变量；未设置时使用本文列出的默认值，需要调整时再覆盖对应参数。
- 部署时核对现有 Deployment/ConfigMap 是否已经设置同名变量，因为显式配置会覆盖代码默认值。线上处理并发按约定保持 36，不要复制 `.env.example` 原有的本地覆盖值 12。
- Redis 沿用现有连接配置，所有后端副本共用同一 Redis 数据库和键空间；本轮无需新增限频专用连接池。

## 部署阶段待验

真实 Redis Lua 执行、TTL、跨副本合计额度、旧回执数据库读取及降级恢复需在部署阶段联调；这轮未连接真实 Redis/MySQL 验证新逻辑。随后按 1000 人浏览＋持续 30 人下单流程＋30 人同刻提交检查新增开销、成功率及延迟，分别统计 429/503；不能把被拦截的请求算作成功吞吐，也不能用本轮功能测试宣称容量提升。
