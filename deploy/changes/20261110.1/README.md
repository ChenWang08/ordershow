# ACK 20261110.1 后端增量交付包

本版仅构建后端 `order-show-ack-backend:20261110.1`，源码为 `fbc9f39991c6c56f3278deba4950b18ad3cc6779`，分支 `codex/ack-cloud-adaptation`。API 与 export-worker 共用同一后端镜像；前端保留已交付的 `20261106.1`。本轮按用户要求仅做本机构建、隔离验收与打包，**不上传 CODING，不部署真实 ACK，不执行云端 SQL**。最终镜像身份及验证结果见 `images.json` 和 `verification/`。

## 变化与前提

- 相对 `20261106.1` / `cecc235`，业务代码仅修改统一 HTTP 入口的活动锁选择：抽奖候选预览、订单试算、订单变更通过/驳回使用共享锁。归档/删除/配置检查和同客户串行保护保留；正式开奖、调价及其他原排他入口维持原保护。
- 数据库仍要求 **V054**，没有新增 SQL、Java 迁移、环境变量或连接池。实际目标版本本轮未连接查询；若已为 V054，无需执行 SQL。低于 V054 时，先由 DBA 按实际版本选择仓库 `deploy/dba/` 的有序升级路径；本包不重复附带历史或空库 SQL。
- 保持云端 Flyway、历史启动迁移、演示初始化关闭；连接值、密钥、MinIO/OSS 选择仍由部署配置注入。本次 V054→V054 镜像更新保留目标库已有业务数据；新环境生产初始化仍按原流程重新导入，不能复制本机业务卷。
- 支持多副本手动扩缩，无 HPA。4 API + 1 worker 的已配置连接上限预算为 86；滚动期间同时 5 API 为 107，另留终止中 Pod、监控和 DBA 连接余量。增加 API 副本不会增加共享任务的全局执行并行度。

## 文件与上传状态

- `images.json`：新后端本地身份、源码、平台、非 root 用户与计划仓库标签；前端复用原身份。后端 `pushed=false`、`remoteDigestVerified=false`，没有伪造远端摘要。
- `backend.patch.json` / `export-worker.patch.json`：只更新指定 Deployment/容器的镜像，保留现有 namespace、连接配置、Secret、资源和副本数。默认名称为 backend/backend、export-worker/export-worker，须按实际环境核对。
- `rollback-backend.patch.json` / `rollback-export-worker.patch.json`：恢复 `20261106.1` 的历史已验后端仓库摘要；不更新前端，不执行数据库降级。
- `verification/`：本轮实际验证、安全结果及云端待验项目。私有合成会话、业务配置、完整日志均不进入交付包。
- `SHA256SUMS`：包内校验清单。`outputs/delivery/ack-20261110.1.zip` 只含此目录的部署资料，**不包含镜像 tar**；新镜像保留在本机 Docker。

计划上传目标：`g-ttsu8985-docker.pkg.coding.net/devops-admin/wilmar-docker/order-show-backend:20261110.1`。本轮未上传，因此包内更新补丁暂用计划标签，**不能将此包视为可直接在 ACK 拉取的新镜像**。后续获准上传时应推送同一已验镜像，独立核验远端摘要，更新 images.json、API/worker 补丁、SHA256SUMS 和 ZIP 后再交给部署团队；测试与生产提升同一摘要，不覆盖旧标签或重新构建同名已验版本。

## 后续 ACK 部署步骤（本轮未执行）

1. 完成上述上传与独立摘要核验，将 API、worker 的新镜像引用固定为同一仓库摘要；保留原前端 `20261106.1`。
2. 核对集群、namespace、Deployment/容器名、目标 V054、现有配置与实际副本数，保存原清单、镜像摘要及回退依据。云端会话与广播使用相同共享数据库/Redis，配置一致；按目标数据库上限核对连接余量。
3. 对两份更新补丁执行 server-side dry-run。选择低峰/维护窗口，更新 API 全部副本及 worker，等待全部新副本就绪；新旧 API 混跑期间旧副本仍有原预览/审核阻塞行为，不以短暂混跑作为修复验收。

```sh
# 仅在后端已上传、独立核验并更新为相同摘要后执行。
kubectl config current-context
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE patch deployment export-worker --type=strategic --patch-file=export-worker.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json
kubectl -n TARGET_NAMESPACE patch deployment export-worker --type=strategic --patch-file=export-worker.patch.json
kubectl -n TARGET_NAMESPACE rollout status deployment/backend --timeout=300s
kubectl -n TARGET_NAMESPACE rollout status deployment/export-worker --timeout=300s
```

4. 用真实身份验证共享会话、跨 Pod 广播、两类预览、审核通过/驳回、不同客户并行下单、同客户串行、正式开奖互斥及导出领取/下载。观察数据库锁等待、连接池等待和混合场景耗时，再手动扩缩验证会话和任务连续性。真实 PolarDB/OSS/Redis TLS/Ingress 与云端性能验收见 `verification/pending-cloud.json`，本地结果不代表云端容量或零等待承诺。
5. 失败时保留日志和任务状态，在受控窗口用两份 rollback 补丁恢复原后端摘要，再检查全部 API、worker、会话和任务。两版均使用 V054，本次应用回退不降级数据库；回退会恢复旧预览/审核的锁行为。

## 本地复跑

构建使用固定提交的 Git archive 作为上下文，运行 `backend/Dockerfile`，显式指定 `--platform linux/amd64 --build-arg SKIP_TESTS=false`，并写入 version/revision 标签。源码专项复跑方式见 `docs/testing/activity-write-lock-http-2026-11-09.md`；源码测试使用独立数据库，不连接业务库。

最终镜像验收使用独立 `order-show-ack-smoke` 项目，MySQL 为 V054 DBA 空库脚本、独立匿名卷，Redis/MinIO 为本地替代服务。可在 `deploy/verify/compose.yaml` 分别设置 `ACK_BACKEND_IMAGE_TAG=20261110.1` 和 `ACK_FRONTEND_IMAGE_TAG=20261106.1`；旧 `ACK_IMAGE_TAG` 仍作为兼容回退变量，设置它时应同时明确前端版本。只在检查该临时项目确无既有用户容器后启动，完成后仅清理本轮临时栈与匿名卷，公共 Maven 缓存保留。
