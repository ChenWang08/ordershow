# ACK 20261029.3：干净基础镜像重建

本轮只重新构建与验证，业务源码基线 `6bd1f6e`，功能仍为20261029.2已合入的 main `74e5b8d` 和 `ac92fc6`。未纳入任何主项目未提交修改。标准Dockerfile、依赖清单、前后端业务代码均未变；验证脚本仅改为按ACK_IMAGE_TAG保存结果，防止覆盖旧记录。

## 镜像大小与身份

| 镜像 | 20261029.2 | 20261029.3 | 层数变化 |
| --- | ---: | ---: | ---: |
| ACK后端 | 969,915,189字节 | 627,502,110字节 | 11→9 |
| ACK前端 | 1,350,593,379字节 | 1,309,605,894字节 | 15→9 |

以上为本机docker image inspect Size口径，与Docker Desktop对应；不是实际仓库上传/下载的压缩大小，也不能直接相加当作磁盘独占用量（层可共享）。后端减少342.4MB，约35.3%；前端减少41.0MB，约3.0%。

- `order-show-ack-backend:20261029.3`：`sha256:f8d914341afc07651066291aaf2fcba0857494276c2dd1e5291738290442acbb`。
- `order-show-ack-frontend:20261029.3`：`sha256:2b36a726f8ed85b10ba923a8bf3b35a13d65550fa5881766196dc63f2bd30136`。
- 均为linux/amd64，运行用户分别ordershow/node；实际双后端及前端容器镜像ID已核对。
- 20261029.2前后端镜像保留，不移动其标签、不覆盖原摘要；回退信息见[上一版](local-images-20261029.2.md)。

## 原因与重建方式

之前Docker Hub连接失败，离线构建以旧ACK业务镜像为基础，再COPY新JAR或前端产物。旧包仍保留在历史层，导致后端累积三份约90.3MB应用包层。本轮Docker Hub连接恢复，按标准多阶段构建：Maven阶段编译测试，最终Java运行环境只复制一个新JAR；前端Node阶段npm ci与生产编译，最终干净Node环境只复制当前依赖、dist和public。

```powershell
docker build --platform linux/amd64 --no-cache --build-arg SKIP_TESTS=false -f backend/Dockerfile -t order-show-ack-backend:20261029.3 .
docker build --platform linux/amd64 --no-cache --build-arg NEXT_PUBLIC_API_BASE=/api/v1 -f Dockerfile.frontend -t order-show-ack-frontend:20261029.3 .
```

无旧业务镜像作为FROM；正常使用Dockerfile声明的Maven/npm依赖缓存，未复用旧业务产物。后端history仅一层约90.3MB应用包。前端依然较大，因为现有运行镜像复制完整node_modules（约798.9MiB），主要包括Next、Cloudflare、构建工具等；dist约7.4MiB、public约3.8MiB。本轮没有擅自删开发依赖或重写部署方式，更深层前端依赖裁剪需要独立评估与测试。

## 内容一致性与验证

- 新旧JAR解包后，BOOT-INF下441个文件逐字节一致，包含129个依赖JAR、业务类、配置和迁移资源；无功能删除。
- 前端新旧package.json与package-lock.json完全一致。新镜像重新npm ci并生产编译，ACK API仍为同域 `/api/v1`。
- 后端构建212项：167通过、45按环境跳过，0失败；跳过项不记为通过。
- 最终镜像双副本回归通过：共享会话/CSRF、MinIO及私有文件、双执行器导入单次发布、Redis事件扇出、重启恢复、UTC、背景与重新开放。
- 手动新增96项API状态断言通过；事件与四类统计API117项检查通过。
- 180项综合/41项特渠订单201项API状态检查通过：跨副本同键幂等、同版本不同键竞争、原样提交不新增版本、减量审核拦截、旧键重放、历史明细对账正确。
- cloud/test profile、带密码Redis、OSS占位配置启动且readiness正常。未访问真实OSS或PolarDB。
- 验证脚本ESLint通过。本轮业务代码未改，未重复上一版975组SQL差分和前端272项源码测试；本轮重跑的镜像级测试如上。

## 浏览器验收与环境清理

最终镜像的看板、排行、战报在真实浏览器静置174.357秒，期间新增合成订单变更，三个统计接口均维持首次各一次请求，统计SSE请求为0。点击各页手动刷新后，各增加一次统计请求；看板与战报显示最新44,600元、44.6吨，排行吨数筛选应用正确。此行为与20261029.2已交付的手动刷新要求一致。

2026-10-29 21:24:33（北京时间）完成隔离栈清理。原本地前端、后端、MySQL、Redis、MinIO五个业务容器的ID、镜像、启动时间、挂载及环境前后一致。验证代理和浏览器页已关闭。页面计数、截图及核验结果保存在本轮outputs目录。

## 发布边界与回退

构建验证阶段没有推送CODING；随后按用户授权完成下述镜像交付。没有推送Git、部署线上或替换现有本地业务服务。旧浏览器页面需重新加载才能使用已交付的手动刷新代码。没有数据库迁移，无需为镜像回退覆盖数据库。

后续部署使用本记录镜像摘要，并在实际ACK资源下验证PolarDB、Redis TLS、OSS、Ingress和性能容量。本轮没有高并发容量测试，不把小型接口回归时间当作P95或线上容量结论。

## CODING 镜像交付：2026-10-29

按用户授权，为上述两个本地20261029.3镜像添加指定仓库标签并推送，未重新构建。前后端docker push均退出码0；随后分别通过docker buildx imagetools inspect读取仓库，索引摘要与上表本地摘要完全一致，业务平台均为linux/amd64。已有层复用，缺少的层和新版本元数据已上传。原有20261019.1、20261027.1仓库标签未覆盖。

- 前端：`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-frontend:20261029.3`
- 后端：`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-backend:20261029.3`

本次仅推送镜像，不更新ACK工作负载、不连接或修改测试环境数据库、不操作原本地业务容器。真实测试环境部署与验收仍待部署团队完成。

隔离回退时设置 `ACK_IMAGE_TAG=20261029.2`，按 `deploy/verify/compose.yaml` 重建前后端；云端由运维恢复上一套已验收的前后端摘要。所有本轮日志、镜像信息、内容比对及页面计数位于忽略目录 `outputs/ack-release-20261029.3/`，含配置的私有快照不上传。
