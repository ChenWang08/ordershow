# 订购会业务系统

面向调味品事业部订购会的完整本地业务系统。项目保留已确认的 React UI，并已接入 Spring Boot、MySQL、Redis、MinIO、Excel/ZIP 导入、H5 订单、后台只读订单管理、实时排行、专题战报、抽奖和审计日志。

## 当前实现

- H5：按综合/特渠和大区验证白名单手机号，读取对应商品，提交、修改、撤回和重新提交订单；每次非空提交生成不可变版本。
- 商品：统一 Excel 四个 Sheet 预览、异常行编辑/删除、原子发布、手动维护、图片 ZIP 按物料名称匹配、多图存储。
- 客户：白名单 Excel 两个 Sheet 预览和发布；综合/特渠允许同手机号；手机号加密存储，登录后的白名单管理页显示完整电话，订单和公开页面仍脱敏；支持当前版本单条维护和删除。
- 到场：现场名单 Excel 每次全量替换；发布时在参会人员类型内按手机号、经销商全称、同分公司经销商简称依次精确匹配当前白名单，展示已关联、待确认、未关联状态，也支持单条补录；登录后的到场管理页显示完整电话。
- 后台订单：只读列表、详情、商品快照、版本、操作轨迹、搜索、筛选和 Excel 导出。后台没有代下单、改单、撤回接口。
- 看板：活动概览、有效订单排行和专题战报均读取真实订单；后台概览每 10 秒刷新，现场看板使用 SSE 变更通知；撤回订单不计入统计。
- 抽奖：规则和轮次配置、候选资格校验、Redis/数据库防重、候选快照、后端随机、结果先持久化再播放动画、完成和重抽留痕。
- 安全：管理员会话、H5 会话、CSRF、幂等键、手机号 AES-GCM 加密及 HMAC 检索、自动审计日志。

本地源数据包含 233 条可见商品（229 条可订）、1,647 名有效白名单客户和 121 条到场记录。按当前精确规则复算后，108 条已关联并具备“现场到场客户”抽奖资格，3 条因手机号与名称冲突待确认，10 条未关联；另有 190 个唯一图片文件。实际运行结果以最近一次发布版本为准，源 Excel/ZIP 不进入 Git。

## 一键启动

前置条件：Docker Desktop 已启动。Java 和 Maven 仅在脱离 Docker 调试后端时需要；正常本地运行不需要额外安装 MySQL、Redis、MinIO 或 Maven。

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

访问地址：

- 前端：http://localhost:3000
- H5 下单：http://localhost:3000/h5/2026-mid-autumn
- 管理后台：http://localhost:3000/admin/login
- 排行大屏：http://localhost:3000/screen/2026-mid-autumn/ranking
- 专题战报：http://localhost:3000/screen/2026-mid-autumn/report
- 抽奖大屏：http://localhost:3000/screen/2026-mid-autumn/lottery
- 后端健康检查：http://localhost:8080/api/v1/actuator/health
- MinIO 控制台：http://localhost:9001

H5 和现场大屏的活动编号来自 URL；管理后台当前默认进入 `.env` 中配置的活动。以上入口仍由同一个前端服务提供，并共用同一个后端和数据库。

首次启动的后台账号由 `.env` 中 `BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD` 决定，默认是 `admin / ChangeMe123!`。首次登录必须修改密码；正式部署前必须替换所有默认密码和密钥。

停止服务：

```powershell
docker compose down
```

该命令保留数据库和文件卷。只有明确需要清空全部本地数据时才使用 `docker compose down -v`。

## 开发与测试

前端：

```powershell
npm ci
npm run dev
npm test
```

后端编译和测试：

```powershell
docker run --rm -v order-show-m2:/root/.m2 -v ${PWD}:/workspace -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -f backend/pom.xml test
```

完整容器构建：

```powershell
docker compose build
```

## 冻结业务规则

- 加入当前活动且物料名称有效的商品可进入 H5；缺少可选字段时隐藏该字段并标记待完善。
- 缺少有效元/箱的商品可展示但不可下单；缺少吨箱转换系数仍可下单，订单总吨数整体留空。
- 客户只能在活动有效期内自行提交、修改、撤回或重新提交；截止后全部只读。
- 后台订单只读并支持导出，管理员不能修改商品数量、提交订单或撤回订单。
- 白名单和到场管理页可向已登录管理员显示完整电话；H5、订单管理、排行、战报、抽奖大屏和日志不得显示手机号明文。
- 商品、白名单和到场名单均以最近一次发布的完整文件为准；当前页面不提供停用/恢复功能。单条删除后从当前列表消失，底层仅为保护历史订单和审计保留不可见记录。
- 商品、白名单和现场到场 Excel 均为全量替换；当前业务只读取最近发布版本，旧版本仅供审计。
- 每次商品 Excel 与本次图片 ZIP 构成独立待发布批次，不比较上一商品版本，也不继承上一版本图片；上传仅用于预览，确认且全部保存成功后才切换当前版本。商品状态为“有效 / 待核对 / 待完善”，并可按“价格有效 / 价格待完善”单独筛选；图片状态为“已匹配 / 待确认 / 未匹配”。
- 每次白名单 Excel 也是独立的完整名单，上传仅生成预览，确认后才全量替换；页面状态只显示“有效 / 待处理”，不展示新增、更新或移除等跨版本差异。
- 到场名单每次发布都清除上一版本的当前关联语义，并对当前完整白名单重新关联；白名单重新发布时也自动重算当前到场关联。
- 抽奖结果由后端生成并先保存，前端动画不参与随机计算；现场到场候选必须处于“已关联”状态并指向当前有效白名单，按活动客户 ID 去重。

详细架构、数据库、接口、安全和状态机文档见 [docs/design/README.md](docs/design/README.md)，OpenAPI 契约见 [order-show-api.yaml](docs/design/openapi/order-show-api.yaml)。

## 上线前必须完成

- 在独立正式环境重新导入最终审核版 Excel/ZIP，不直接复用本地卷。
- 配置 HTTPS、正式域名、强随机密钥、对象存储和数据库备份。
- 确认活动时间、商品价格、白名单异常、抽奖奖品和人数。
- 清零测试订单与抽奖结果，执行现场网络、投屏、订单核算、恢复和并发演练。

## 当前实现与生产规划边界

当前仓库已经实现可完整本地运行的单体版本：统一 React 前端、一个 Spring Boot 后端进程，以及由 Docker Compose 管理的 MySQL、Redis 和 MinIO。导入任务和 Flyway 迁移当前随本地后端运行方式执行。

独立 Background Worker、独立 Migration Job、多 API 实例、托管 LB/WAF/CDN、正式监控告警和云端高可用属于生产部署目标，尚不能视为当前本地环境已经完成。
