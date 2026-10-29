# 白名单验证与大订单提交：本地部署记录

2026-10-29 17:21:48（北京时间）完成本地 `E:\fengyi\order_show` 后端更新及部署后核对。仅替换 `order-show-backend-1`，未同步 ACK、推送 CODING、推送镜像或部署云端。本轮代码、测试及部署文档随本次本地 Git 提交保存。

## 镜像及范围

- 新镜像：`order-show-backend:h5-performance-20261029.1`，`order-show-backend:latest` 同步指向该版本。
- 新镜像 ID：`sha256:852d569e20b4603d6cbcfd0ae775e938be0530935262d5fd7b407df1617347f4`。
- 回退镜像：`order-show-backend:h5opt-20261029-before`。
- 回退镜像 ID：`sha256:afadf560198c94ac3f4ae9616d773b94f0a9f705c1dde893ceb7f4b4d853e8c0`。
- 标准 `backend/Dockerfile` 构建，基于 `dc4b76c` 加本轮尚未提交的后端改动。源码哈希记录在 `outputs/load-h5opt-20261029/source-hashes.json`，部署前再次核对一致。

白名单查询利用已有联合索引；商品阶梯价一次关联读取；已提交订单的旧数量一次读取复用。业务校验、错误优先级、事务、完整版本快照、审计、幂等、实时通知和轮询规则保留。批次仍100行。未增加数据库迁移或索引，数据库仍V039。

本轮没有重建或更新前端。工作区另一组后台会话恢复改动保留，不包含在本次后端镜像中。

## 验证与结果

后端全量201项：168通过、33条件跳过；另行启用的实际接口/数据库24项全部通过。白名单新旧行为975组对照通过。已有前端259项测试在另一组前端改动出现前通过，不代表对之后工作区前端的验收。

同资源独立快照测试：验证P95约506→91ms，首次大订单提交981→928ms，持续修改737→622ms。混合下单和四类看板刷新时数据及通知正确，但统计P95仍约5.7～7.8秒，提交534→600ms；不宣称混合负载容量已改善。详见[完整验证报告](../testing/h5-verification-submit-performance-2026-10-29.md)。

部署前后只读核验一致：

| 内容 | 前后数量 |
| --- | ---: |
| 主订单 | 455 |
| 当前明细 | 2715 |
| 订单版本 | 501 |
| 版本明细 | 2862 |

主订单金额48,239,941.98、数量306,193、吨数1463.047112及历史汇总均一致；活动状态、数据库版本一致。历史活动 `HD20261010009` 的看板、金额排行、吨数排行、战报响应数据完全一致，后端就绪检查HTTP 200。

五个业务服务的环境配置和挂载均与更新前一致；前端、MySQL、Redis、MinIO的容器ID、启动时间、镜像均未变。业务库未写入压测数据。本轮隔离测试容器已移除，合成卷、SQL快照、原始日志保留在本机；部署核对原始文件含配置，仅保存在忽略目录，不应上传。

## 部署及回退

本次执行：

```powershell
docker tag order-show-backend:h5-performance-20261029.1 order-show-backend:latest
docker compose -p order-show -f docker-compose.yml up -d --no-deps --no-build --wait --wait-timeout 120 backend
```

如需回退，在项目目录执行：

```powershell
docker tag order-show-backend:h5opt-20261029-before order-show-backend:latest
docker compose -p order-show -f docker-compose.yml up -d --no-deps --no-build --wait --wait-timeout 120 backend
```

无需回退数据库结构。回退后应再次确认就绪健康及历史统计数据。
