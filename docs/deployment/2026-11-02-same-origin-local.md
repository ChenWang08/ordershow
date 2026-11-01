# 本地页面与接口统一入口

## 范围与部署

本轮在[图片与订单读取优化](2026-11-02-image-local.md)之后，只优化本地 Docker 的跨域预检。新增 Nginx 统一入口，对外地址仍为 `http://localhost:3000`：

- 页面请求转给 Docker 内部的 `frontend:3000`。
- `/api/v1/` 请求转给 `backend:8080`，路径和查询参数完整保留。
- 本地 Compose 构建前端时设置 `NEXT_PUBLIC_API_BASE=/api/v1`，H5、后台、排行、看板、战报、抽奖及图片通过共用 API 地址访问同一入口。
- 后端的跨域许可配置继续有效；通过消除浏览器跨域访问来省掉预检，不删除业务校验或版本请求头。

入口配置为 `deploy/local/nginx.conf`，以只读文件挂载。保留请求体、Cookie、CSRF 和版本头、多个 Set-Cookie、响应状态及图片缓存头；上传和下载使用流式转发，上传上限与后端现有的 170MB 请求限制一致。向后端传递外部 Host、协议和客户端地址。Docker DNS 定期重新解析，支持上游容器重建。

| 服务 | 本轮固定标签 | 实际镜像 ID |
| --- | --- | --- |
| 前端 | `order-show-frontend:local-same-origin-20261102.1` | `sha256:fdb6e797d12a8acc75afcfc56d3d5f73942e4f9f1a0d249fe98b70342ad798c6` |
| 统一入口 | `order-show-gateway:local-same-origin-20261102.1` | `sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949` |

统一入口使用本次拉取的 `nginx:stable-alpine`，本轮镜像摘要与表中 ID 一致。固定标签覆盖文件为 `outputs/same-origin/release.compose.json`，部署命令为：

```powershell
docker compose -f docker-compose.yml -f outputs/same-origin/release.compose.json up -d --no-deps --no-build --pull never frontend gateway
```

已核对 backend、MySQL、Redis、MinIO 的容器 ID 未变化，`.env` 哈希未变化。后端仍使用上一轮图片版本，数据库未迁移。ACK 目录未修改。活动检查周期、304、查单触发条件及 15 秒防重复查询继续使用现有逻辑。

## 相关验证

先在临时本地 `3101` 入口完成相关验证，再更新 `3000` 入口并复核；临时容器已移除。

- Nginx 配置检查、Compose 配置检查通过。
- `tests/activity-info-http.test.mjs` 的 8 项现有测试通过。
- 验证脚本语法检查通过。
- 实际公开活动接口首次返回 200，携带版本标识后返回空体 304。
- 缩略图返回 200，条件请求返回 304，30 天缓存头保留；代理后的图片字节与后端直接读取一致。
- 未登录访问管理接口仍返回 401，管理后台登录页正常显示。
- 真实浏览器打开 H5、排行、看板、后台登录页；排行选项和看板数据返回 200。H5 使用浏览器时钟推进一次约 30 秒活动检查，实际收到 304。
- 部署复核记录到 11 个浏览器接口／图片请求，全部使用页面所在地址，预检 0 次，无页面脚本异常。

未创建或修改业务订单、审核或导入数据，未执行容量测试和全量回归。本轮验证覆盖入口转发，不代表下单吞吐量测试，也未实际登录账号或提交订单。

验证脚本为 `scripts/verify-same-origin-local.mjs`。记录保存在 `outputs/same-origin/preview-verification.json`、`verification.json` 和 `before-deployment.json`。

## 回退

上一版前端保留为 `order-show-frontend:before-same-origin-20261102`。需要回退时，可在覆盖文件中将 frontend 的 image 改成该标签，仅重建 frontend，保留统一入口容器。旧前端会恢复通过原来的 8080 地址调用接口，页面入口仍为 3000。后端及数据服务不需要回退，不删除数据卷。本轮未执行回退。
