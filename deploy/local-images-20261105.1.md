# ACK 本地镜像交付：20261105.1

## 范围与源码

本轮在 E:\fengyi\order_show-ack 的 codex/ack-cloud-adaptation 分支同步 main 5aa082b58d5606dc6a36069c7f0c6586ac867fb8，保留 ebe891ba001b1c9ea03cebccb6bb3cf37ec17f00 及既有云端适配。最终 ACK 源码提交、镜像 ID 和验证结果将在完成后补录；当前处于本机构建验收阶段。

目标镜像为 order-show-ack-backend:20261105.1 和 order-show-ack-frontend:20261105.1，linux/amd64、非 root，前端同域 /api/v1。导出 worker 复用后端同一镜像，通过 --export-worker 启动；本轮只准备本机镜像及部署包，用户负责推送、部署团队负责上线。

## 配套要求

- API 4 副本，每副本业务池 20、配置复制池最多 1；worker 1 副本最多 2 连接。常态预算 86，滚动同时运行 5 个 API 时 107，另留终止中的 Pod、维护及监控余量。H5 每 API 36 处理/50 等待/12 秒上限，共享 Redis 10 秒 3 个新操作和 20 次总请求。
- 数据库目标 V053。已有 V049 使用 dba/generated/upgrade-v049-v053.sql；新空库用 fresh-install.sql，不能交叉使用。保持 cloud profile、关闭自动迁移/演示初始化、保留 UTC 与安全 Cookie。
- k8s/apps.yaml 保留 ebe891b 的 4 API 和每 API 2 CPU/4Gi 资源上限、2 前端；另交付 k8s/export-worker.yaml。worker 使用 SPRING_MAIN_KEEP_ALIVE=true、0.5 CPU/512Mi、256Mi Java 堆、磁盘型 2Gi emptyDir 和 1Gi 导出预算，fsGroup=10001。worker 无 HTTP 接口，startupProbe 仅检查进程与临时目录，需监控任务状态、租约、失败和导出耗时。
- OSS 的复制/删除与流式导出保留 SDK 错误分类；只有 NoSuchKey 视为对象缺失。需要读取源、写入目标和删除对象权限，真实 OSS 行为待团队 UAT 验证。对象恢复单独制定，不以 SQL 备份替代。
- 最新手动刷新 10 秒冷却、排行条件确认、导出/删除进度在途禁用均纳入；H5 沿用 15 秒刷新规则。冷却仅为当前页面交互限制，不宣称为服务端或跨用户统计限流。

## 发布与回退

先记录目标 ACK 镜像、DBA 结构版本、实际配置及备份。按维护窗口停写/停任务、DBA 升级、更新全部 API 与 worker、更新前端的顺序发布。测试和生产使用同一镜像摘要；线上地址、密钥、imagePullSecrets、Ingress 与 namespace 由团队在私有副本中填写。

保留 20261102.1 镜像；应用/结构/对象恢复须一起评估，尤其不能通过换旧镜像撤销永久删除。真实 ACK、PolarDB、Redis TLS/Lua、OSS、Ingress HTTPS/缓存头与持续高峰容量属于团队待验项，本机隔离结果不代替这些检查。
