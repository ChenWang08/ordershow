# 商品导入项目组筛选：本机前端部署

部署时间：2026-10-27 14:01:39（北京时间）。部署目录：`E:\fengyi\order_show`，Compose 项目：`order-show`。

## 发布版本

| 服务 | 镜像标签 | 镜像 ID |
| --- | --- | --- |
| 前端，本次更新 | `order-show-frontend:project-filter-20261027-135923` | `sha256:11047c09bbd2a63d50ae3fa791d359b9208f4680191b923f71892983143b5269` |
| 后端，沿用原版本 | `order-show-backend:ranking-20261027` | `sha256:0a30ddafb85c702f145618fa23f4f2212268e14d7a6028a64e106d48b51f5764` |

前端 `order-show-frontend:latest` 已同步指向本次版本，3000 端口的 `order-show-frontend-1` 实际运行镜像 ID 已与该标签核对一致。本次功能、测试和文档已纳入本地 main 分支提交；镜像在提交前由本次修改的工作区源码构建，未推送远程镜像仓库或部署服务器。

本次加入“项目组”筛选及筛选栏换行布局，功能规则和测试详见 [功能与验证记录](../testing/product-project-filter-2026-10-27.md)。

## 构建和更新

标准 `Dockerfile.frontend` 构建在访问 Docker Hub 的 Dockerfile 构建前端镜像时连接超时，尚未改动业务服务。随后复用更新前前端镜像中的 Node.js 24.22.0 和已安装依赖，复制当前源码、配置和静态文件，在新构建阶段执行 `npm run build`，将新产物复制到运行镜像。

构建前核验旧镜像与工作区 `package.json` 和 `package-lock.json` 的 SHA-256 完全一致；没有替换依赖版本。临时备用配方位于被 Git 忽略的 `work/product-project-filter/Dockerfile.frontend-local`，通过 `BASE_IMAGE` 显式指定下方回退标签。正式 Dockerfile 和 Docker 网络配置未修改。

新镜像构建通过后，检查客户端产物包含项目组筛选，执行：

```powershell
docker tag order-show-frontend:project-filter-20261027-135923 order-show-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

仅替换前端容器。后端、MySQL、Redis、MinIO 的容器 ID 和镜像 ID 在部署前后完全一致。没有新增迁移或业务数据修正，数据库继续沿用 V039。

## 验收与边界

- 修改后前端生产构建、252 项测试、类型检查、ESLint 和合成数据浏览器回归已通过，宽窄布局验证记录见功能文档。
- 部署后后台 `http://localhost:3000/admin` 返回 200；实际提供的新客户端文件 `/assets/order-show-app-Bh8xtGEM.js` 返回 200，内容包含“未填写项目组”等本次筛选实现。
- 后端健康状态 `UP`，前端运行正常；辅助服务保持原容器与镜像。
- 本次发布验收为 HTTP、实际资源、运行镜像及服务状态核验；没有在真实登录态下重新操作商品筛选，没有写入或删除业务商品。刷新后台后使用新前端；若旧页面仍展示旧筛选栏，可强制刷新页面。

镜像与容器核验记录、依赖校验和构建日志保留在本机 `outputs/product-project-filter-release.json`、`outputs/product-project-filter-deploy-verification.json`、`outputs/product-project-filter-containers-*.txt`、`outputs/product-project-filter-docker-build*.log`。

## 回退

更新前实际运行镜像已保留为：

- 标签：`order-show-frontend:before-project-filter-20261027-135923`。
- 镜像 ID：`sha256:19d92da52be9119aa7b1e621fc0d1afd548a33107f9252fbba87f53efa92cd6c`。

如需回退，在项目目录执行：

```powershell
docker tag order-show-frontend:before-project-filter-20261027-135923 order-show-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

随后刷新浏览器。本次无需回退后端或数据库。
