# 看板、排行和战报查询性能优化：本地部署记录

完成时间：2026-10-29 14:25:01（北京时间，含部署后核验）。
部署目录：`E:\fengyi\order_show`；Compose 项目：`order-show`；前端端口 3000，后端端口 8080。

## 部署状态与范围

本次已构建并更新本地前后端，未同步 `E:\fengyi\order_show-ack`、推送远程镜像或部署线上。
镜像由基于 `34d73b1dfb2a3fe087827abeb98506384fe6a354` 的尚未提交工作区源码构建，以以下镜像 ID 标识实际部署版本。

只替换 `order-show-frontend-1` 和 `order-show-backend-1`。MySQL、Redis、MinIO 的容器 ID、镜像和挂载与部署前一致；环境变量与原后端逐字段核对一致，包括数据库连接、业务密钥和存储配置。
没有新增业务表结构、索引、数据库迁移或业务数据修正，数据库仍为 V039。

## 已部署内容

- 排行先筛选当前活动及有效订单，再汇总对应明细；两种排行和累计吨数复用同一份订单吨数小计。
- 看板和战报先汇总项目组明细，再生成全渠道、综合、特渠与综合大区结果，减少重复读取。
- 活动信息就绪后再发起大屏统计请求；页面或筛选失效时取消旧读取。
- 金额与吨数口径、缺失折算处理、排行上限与并列顺序、筛选、历史快照规则保持原样。
- 变更通知、连接建立/重连补拉、15 秒轮询和手动刷新保留；未增加 TTL 缓存。

实现、测试夹具、执行计划与性能边界见[完整验证报告](../testing/screen-performance-2026-10-29.md)。

## 部署镜像

`order-show-frontend:latest`、`order-show-backend:latest` 已同步到以下版本，实际运行容器的镜像 ID 已核对一致。

| 服务 | 镜像标签 | 实际镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:screen-performance-20261029-132858` | `sha256:3f988ffa3d932f826598aec64f705c3fd7c40301b0c9f73c774620cb32606633` |
| 后端 | `order-show-backend:screen-performance-20261029-132858` | `sha256:afadf560198c94ac3f4ae9616d773b94f0a9f705c1dde893ceb7f4b4d853e8c0` |

后端使用原 `backend/Dockerfile` 构建。前端原 `Dockerfile.frontend` 两次因 Docker Hub/CloudFront 连接 EOF 未完成，随后以保留的旧前端镜像为基础离线重建：

1. 核对运行镜像与工作区 `package.json`、`package-lock.json` 的 SHA-256 完全相同。
2. 复用已有 Node 与已安装依赖，复制当前源码、配置和静态文件，关闭构建网络后执行 `npm run build`。
3. 运行镜像移除旧 `dist`，复制新构建产物；未改依赖版本、标准 Dockerfile 或系统网络配置。
4. 在临时容器验证管理页和三个大屏页面均为 HTTP 200 后再部署。

本次备用构建文件位于 Git 忽略目录 `outputs/screen-performance-20261029-132858/Dockerfile.frontend-cached`，通过 `PREVIOUS_IMAGE` 显式指定旧前端标签。

## 更新操作

已有回滚镜像和部署前身份记录后，执行了以下本地更新：

```powershell
docker tag order-show-backend:screen-performance-20261029-132858 order-show-backend:latest
docker tag order-show-frontend:screen-performance-20261029-132858 order-show-frontend:latest
docker compose -p order-show -f docker-compose.yml up -d --no-deps --no-build --wait --wait-timeout 120 backend frontend
```

没有重建或重启数据库、中间件，也没有在业务环境执行写入测试。隔离 `order-show-e2e` 测试容器与网络已清理。

## 测试与性能

- 前端 259 项测试、类型检查、ESLint 与生产构建通过。
- 后端完整回归 198 项：166 通过、32 按环境跳过，包含 10 项真实 MySQL 排行测试；另行启用的 14 项接口/数据库回归全部通过。
- 新旧统计实现的大数据逐字段对照通过，覆盖两种排名、筛选、战报、即时数据变更和历史状态。
- 隔离接口回归覆盖四类大屏并发读取期间重新提交订单、收到真实 SSE 通知后读取最新统计，以及幂等、审核、撤回、调价、截止、结束和重新开放等现有流程。

合成夹具目标活动初始 1,620 单，整个测试库约 86 万条明细；以下为统计服务/JDBC 的中位耗时，不包含完整 HTTP、网关、活动信息组装或浏览器渲染，不代表线上首屏或容量验收。

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 金额排行 | 2.63 秒 | 0.73 秒 |
| 吨数排行 | 2.33 秒 | 0.68 秒 |
| 看板/战报 | 3.28 秒 | 1.07 秒 |

看板/战报 P95 为 1.25 秒，尚未达到暂定的 1 秒目标；完整采样及边界见验证报告。未将条件跳过项记为通过，也未据此宣称完成千人持续压测或真实 ACK 验收。

## 部署后只读核验

- 后端 readiness 为 `UP`；管理页、看板、排行、战报和客户端脚本资源均 HTTP 200。
- `HD20261010009` 的看板、金额排行、吨数排行和总战报响应数据，与更新前序列化结果完全一致。
- 活动状态清单及下列三类数据的行数、金额、数量和吨数汇总与更新前一致：

| 数据 | 行数 | 金额汇总 | 数量汇总 | 吨数汇总 |
| --- | ---: | ---: | ---: | ---: |
| 订单主表 | 455 | 48,239,941.98 | 306,193 | 1,463.047112 |
| 当前明细 | 2,715 | 48,239,941.98 | 306,193 | 1,463.047112 |
| 订单历史版本 | 501 | 50,050,053.78 | 316,030 | 1,534.719360 |

以上是部署时刻的全表汇总核对，不表示对所有业务记录逐字段导出校验或数据库全量备份。业务库活动当前为历史或草稿，部署后实际业务库核验覆盖历史读取；实时下单和通知在隔离环境验证，没有在业务库创建测试订单或重新开放活动。

部署前后容器身份、挂载、汇总数据、历史接口响应和构建/测试日志保存在 `outputs/screen-performance-20261029-132858/`。

## 回退

旧前后端镜像已保留：

| 服务 | 回滚标签 | 更新前实际镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:screen-performance-20261029-132858-before` | `sha256:11047c09bbd2a63d50ae3fa791d359b9208f4680191b923f71892983143b5269` |
| 后端 | `order-show-backend:screen-performance-20261029-132858-before` | `sha256:0a30ddafb85c702f145618fa23f4f2212268e14d7a6028a64e106d48b51f5764` |

如需回退，在本项目目录执行：

```powershell
docker tag order-show-backend:screen-performance-20261029-132858-before order-show-backend:latest
docker tag order-show-frontend:screen-performance-20261029-132858-before order-show-frontend:latest
docker compose -p order-show -f docker-compose.yml up -d --no-deps --no-build --wait --wait-timeout 120 backend frontend
```

随后核对健康状态、客户端资源及历史统计，刷新本地页面。本次无表结构变更，应用回退不需要恢复或覆盖数据库和数据卷。

## 后续交付边界

ACK 源码、镜像和配置未更新，线上版本未改变。通用改动须在后续同步到 ACK 后，连同其同域 API、云资源和多副本通知机制一起验证，再另行构建交付。
