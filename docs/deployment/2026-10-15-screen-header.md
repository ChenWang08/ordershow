# 展示页面顶部栏自动收起部署记录

## 09:03 鼠标入口修正（当前部署）

2026-10-15 09:03（北京时间）按用户要求再次仅更新前端：独立的透明感应区始终覆盖整条顶部，鼠标使用时隐藏右上角箭头（展开状态也不显示）；纯触屏保留点击入口，键盘聚焦时保留可见操作入口。带触屏能力的电脑在检测到鼠标移动后也隐藏箭头。

- 当前镜像：`order-show-frontend:header-mouse-20261015-090053`，ID `sha256:0830cda00ace894fd435cc3616c533ac0d2544faee142bb8b88e66d22524bffc`；默认 `latest` 已同步更新。
- 本次更新前镜像保留为 `order-show-frontend:before-header-mouse-20261015-090053`（即 08:51 的版本）。昨天常驻顶部栏的回退标签也继续保留。
- 类型检查、相关 ESLint、Docker 构建通过。浏览器回归增加顶部左、中、右三处悬停和触屏电脑使用鼠标场景。
- 实际 3000 端口浏览器验证全部通过：四个页面顶部三处悬停、隐藏箭头、触屏电脑鼠标操作、纯触屏切换，以及管理平台和 H5 保持原样；未捕获浏览器异常。
- 后端及三个数据服务的容器、镜像和挂载均未变化，后端健康状态 `UP`。
- 部署记录：`backups/header-mouse-20261015-090053/deployment.json`；浏览器核验日志：`work/header-mouse-browser.log`。
- 如需仅撤销本次箭头修正，将 `order-show-frontend:before-header-mouse-20261015-090053` 标记为 `order-show-frontend:latest`，再执行下文的仅前端重建容器命令；如需恢复昨天的常驻栏，使用下文原回退标签。

以下为 08:51 首次部署记录。

2026-10-15 08:51（北京时间），按用户授权更新本机 Docker Compose 项目 `order-show` 的 frontend（3000）。

## 本次行为

- 订单看板、订货排行、专题战报、幸运抽奖默认隐藏公共顶部栏。
- 鼠标移到顶部约 120 毫秒后展开，移出后约 500 毫秒收起；栏内有操作焦点时保持展开。
- 顶部栏占据实际布局高度，展开推开内容，隐藏释放空间；已滚动的看板也不会被顶部栏覆盖。
- 支持键盘和触屏显隐入口。管理平台和正式 H5 保持原样。

## 镜像与部署范围

- 部署前实际核实前端仍使用昨天回退的 `sha256:05a64b183fb17991204b0dbcc587ca6b95367b47f393cb2482d86b5572c38729`。
- 旧镜像保留标签：`order-show-frontend:before-header-20261015-084922`。
- 新镜像标签：`order-show-frontend:header-20261015-084922`。
- 新运行镜像 ID：`sha256:c3761e546f86d39262bd4e72fc6f55c077fc6eb8f1fbb27499e41cf4c89e50dd`。
- `order-show-frontend:latest` 已更新到本次新镜像。昨天的回退记录保留为历史记录。
- 仅通过 `up -d --no-deps --no-build frontend` 替换前端。后端、MySQL、Redis、MinIO 的容器 ID、镜像与挂载逐一对比，均未改变。
- 未执行数据库迁移、数据库回退或业务写入。本次未重新统计业务记录数量，不沿用昨天的订单数量作为今日快照。

## 验证

- 新 Docker 镜像构建通过；源码阶段类型检查、相关 ESLint 和 27 项回归测试通过。
- 对实际 `http://localhost:3000` 运行浏览器回归，直接读取业务接口，禁止提交业务写请求。
- 四个页面验证默认无顶部占位、顶部悬停展开、延迟收起、展开不遮挡、键盘切换；订单看板额外验证滚动后展开。
- 四个页面均验证触屏点击展开和收起；管理后台保持 74px 顶部栏，正式 H5 无公共顶部栏；未捕获浏览器异常。
- 后端健康接口返回 `UP`。
- 构建仍提示现有依赖审计问题及较大资源包警告；本次未升级依赖。

证据：`backups/header-20261015-084922/deployment-before.json`、`backups/header-20261015-084922/deployment.json`、`work/header-deployment-browser.log`；截图位于 `outputs/screen-header/`。

## 如需回退

在项目根目录执行下面两条命令，仅恢复前端；不重建旧镜像、不操作数据服务：

```powershell
docker tag order-show-frontend:before-header-20261015-084922 order-show-frontend:latest
docker compose -p order-show -f docker-compose.yml up -d --no-deps --no-build frontend
```

回退后核实前端镜像 ID 为上面的 `05a64b...`，并重新只读检查后台、四个展示页面和 H5。
