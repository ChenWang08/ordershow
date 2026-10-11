# 2026-10-11 晚间更新的本机部署核验（2026-10-12）

本记录于 2026-10-12 对本机 Docker Compose 项目 `order-show` 的现有运行环境进行只读核验，补充此前未记录的晚间更新。核验期间没有重新构建、部署或重启服务，也没有创建或修改真实订单、活动配置及业务数据。

## 运行容器与镜像

下表时间由 Docker 返回的 UTC 时间转换为北京时间（Asia/Shanghai）；创建和启动时间是当前容器的时间，不代表 Git 提交时间。

| 服务 | 端口 | 容器创建时间 | 容器启动时间 |
| --- | --- | --- | --- |
| frontend | 3000 | 2026-10-11 23:37:33 | 2026-10-11 23:37:34 |
| backend | 8080 | 2026-10-11 22:37:38 | 2026-10-11 22:37:40 |

- frontend 镜像：`sha256:26b8b4ee459770a5ec7d9868346a286e20d7da147fd17a9084870e61191f69c7`
- backend 镜像：`sha256:283160789fa8942b6c09d73ce9e2049ee75c5a834f9a78809396b1b3bbbc7c9e`
- frontend 容器运行中；backend、MySQL、Redis、MinIO 容器均报告健康。

代码文档已核对至 `99e7af6`。本次通过运行镜像标识、实际提供的前端资源、数据库及接口响应验证部署内容，未建立镜像与该 Git 提交的精确对应关系。

## 数据库迁移

- 业务库 `flyway_schema_history` 最新迁移为 `038 / activity live room url`，`success=1`。
- `installed_on` 原始查询值为 `2026-10-11 21:47:08`；该值按数据库返回原样记录，未额外推断其时区。
- `activity.live_room_url` 已存在，类型为 `varchar(2048)`，允许 NULL，默认 NULL。
- 前两条迁移为 V037（商品完整性统一）和 V036（可计算订单吨数汇总）。

## 已核实的资源与服务

| 检查 | 结果 |
| --- | --- |
| 后端 `/api/v1/actuator/health` | `status=UP` |
| 前端 `/admin` | HTTP 200 |
| 前端 `/h5/2026-mid-autumn` | HTTP 200 |
| `/assets/order-show-app-WDAUJFEm.js` | HTTP 200 |
| `/assets/index-pEAWUSsC.css` | HTTP 200 |
| `/import-template-products.xlsx` | HTTP 200 |
| `/import-template-whitelist.xlsx` | HTTP 200 |
| `/import-template-attendance.xlsx` | HTTP 200 |

从运行前端容器及实际 HTTP 返回的资源中确认了以下代码标记：

- 直播间返回入口，以及草稿未保存、订单提交结果待确认时的提示。
- Excel 商品模板下载入口；三类模板文件均可访问。
- 手机紧凑视口、订货内容滚动区、焦点及视口偏移处理。
- 数量输入聚焦全选及 `999999` 上限。
- HTTP 来源兼容使用的 `getRandomValues` 幂等键生成逻辑。

这些检查确认资源已提供相应代码，不等同于完整交互验收。

## 多来源 CORS

运行后端的 `PUBLIC_ORIGIN` 为：

```dotenv
PUBLIC_ORIGIN=http://localhost:3000,http://100.66.6.66:3000
```

分别携带上述两个 Origin，对本机后端健康接口发起 OPTIONS 预检，均返回 HTTP 200，且 `Access-Control-Allow-Origin` 与请求来源一致。该检查确认多来源配置已生效，未验证其他设备通过该 IP 访问的网络连通性。

## 核验边界与历史记录

- 本次未执行真实手机或浏览器交互验收，未实际下单、审核订单、保存直播间配置或导入模板数据。
- HTTP IP 下单兼容已确认相关代码存在于服务资源中，未通过真实订单写入验证完整流程。
- 本次未核查晚间部署前的数据备份、业务记录数量或回退镜像，因此不记录未经核实的备份及部署前后数量结论。
- 前次增量直提与减量审核的部署、备份和验证见 [2026-10-10 部署记录](2026-10-10-h5-increment-review.md)。该记录中的镜像与 V037 状态属于当次历史情况，当前状态以上述核验为准。

已有浏览器页面需刷新或关闭后重新进入，以加载当前前端资源。
