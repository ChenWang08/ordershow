# 手动新增修复：本机部署与回退

2026-10-19 14:06（北京时间），本机 `order-show` 已更新前端 3000 和后端 8080。修复、测试和文档已纳入本地 main 分支提交，未同步 ACK 分支，未部署服务器。

## 发布内容

修复白名单新增 SQL 参数不匹配；商品、白名单和到场抽屉直接显示具体保存错误，保留失败输入、阻止重复提交，并区分部分保存成功和新增结果未知。详情和验证边界见 [回归记录](../testing/manual-additions-2026-10-19.md)。

发布镜像：

| 服务 | 当前标签 | 镜像 ID 前缀 |
| --- | --- | --- |
| 前端 | `order-show-frontend:manual-additions-20261019` | `37a9a3630f44` |
| 后端 | `order-show-backend:manual-additions-20261019` | `2291be4f0c4c` |

以上镜像同时标记为对应服务的 `latest`，通过 `docker compose up -d --no-deps --no-build backend frontend` 仅替换前后端。后端复用专项测试通过的同一镜像，不把隔离环境配置带入镜像；业务连接由现有 Compose 运行时环境注入。

MySQL、Redis、MinIO 容器和挂载保持原样，无新增数据库迁移，Flyway 校验 39 项通过，数据库仍为 V039。

## 构建记录

常规 Docker 前端构建两次遇到 Docker Hub 连接超时，失败发生在下载 Dockerfile 构建前端的阶段。随后使用本机部署前前端镜像中的 Node 24.22.0 和已安装依赖重新构建；`package.json`、`package-lock.json` 的 SHA-256 与工作区一致，依赖未变化。

备用构建配方保留在本机 `work/manual-additions/Dockerfile.frontend`（临时目录，不纳入 Git），复制当前源码与配置并执行生产构建；测试镜像指定 8180 API，业务镜像使用默认运行时主机的 8080 API。两份构建均通过，浏览器测试使用新构建的测试前端。

常规构建仍可使用项目原有 Dockerfile；本次没有修改 Dockerfile、依赖版本或 Docker 网络配置。构建、测试和部署日志保留在本机 `outputs/manual-additions-*.log`。

## 本机验收

- 后端健康状态 `UP`；后台和 `h5/HD20261010009` HTTP 200。
- 真实浏览器确认后台登录页和“测试5”综合/特渠双通道入口可用，没有未捕获页面错误。
- 更新前后“测试5”的活动版本、客户/商品/到场/订单记录数及最大更新时间一致；核对记录在 `outputs/manual-additions-business-before.txt` 和 `outputs/manual-additions-business-after.txt`。
- 本次未补录截图客户。真实客户由用户刷新后台后自行添加；业务环境未进行新增验收写入。

## 回退

已核对以下标签与更新前实际运行镜像一致：

- `order-show-frontend:before-manual-additions-20261019`：`614990321cdb`。
- `order-show-backend:before-manual-additions-20261019`：`38acf10d97d0`。

如出现回归，在项目目录执行：

```powershell
docker tag order-show-frontend:before-manual-additions-20261019 order-show-frontend:latest
docker tag order-show-backend:before-manual-additions-20261019 order-show-backend:latest
docker compose up -d --no-deps --no-build backend frontend
```

随后核对健康状态并刷新浏览器。回退应用无需回退数据库；修复后用户成功新增的业务记录保留。旧后端包含此次白名单新增缺陷，回退仅用于处理新的回归。
