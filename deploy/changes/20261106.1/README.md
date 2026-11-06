# ACK 20261106.1 部署团队交付包

**本机镜像构建、隔离验收和交付包已完成。按用户后续授权，前后端 20261106.1 均已上传指定 CODING 仓库，并独立核验远端摘要，供测试环境部署。包内镜像补丁固定已验摘要，API/worker 共用后端摘要；未执行云端 SQL、未部署真实 ACK。**

镜像源码为 `cecc235691196cbb916814feacb985f941b41e57`，分支 `codex/ack-cloud-adaptation`。包含原 20261105.1 功能，以及导出心跳、活动清理与暂停/继续、抽奖候选查询和订单变更审核锁修复。构建、验收和上传状态以 `images.json` 及 `verification/` 为准；本包不代表已部署真实 ACK。

**用户已确认云端数据库为 V053，本包按 V053→V054 增量交付，只附 V054 升级 SQL 与校验依据。此前已应用的 V001～V053 不重跑，已部署环境不执行 fresh-install.sql。** 历史迁移和新空库安装资料保留在仓库原有 `db/migrations/`、`deploy/dba/generated/`，不再复制进本版本目录。该基线来自用户确认，本轮没有连接云库。

## 文件

- `images.json`：两份 linux/amd64、非 root 镜像的源码、本地身份及上传状态；仅在上传并独立核验后填写远端摘要。API 与 export-worker 使用同一个后端摘要；UAT 和生产提升同一摘要。
- `backend.patch.json` / `frontend.patch.json`：仅更新指定容器镜像，保留目标地址、Secret、资源和实际副本数。默认 Deployment/容器名为 backend、frontend，执行前核对。
- `configmap.patch.json`：非秘密配置补丁，包含三个活动清理参数。所有 API 副本必须一致；目标环境的显式 env、Secret 或启动参数若覆盖这些值，应同步核对。
- `export-worker.yaml`：1 副本、0.5 CPU/512Mi、256Mi Java 堆、磁盘 emptyDir 2Gi、导出临时预算 1Gi，非 root、只读根目录。更新已有 worker 前保存当前清单，合并 namespace、拉取凭据与网络设置；无 Service/Ingress。
- `dba/`：V053→V054 增量 SQL、manifest、V054 单份源 SQL 及执行说明。历史升级和新空库资料使用仓库原有 DBA 目录，另行按实际版本选取，不在本次增量包重复附带。
- `verification/`：本版本实际验证结果。跳过未计入通过，早期失败记录不冒充最终通过。
- `SHA256SUMS`：包内文件校验清单。

## 部署顺序

1. 核对集群、namespace、数据库实际版本和现有部署，保存镜像摘要、配置、实际副本数以及数据库/OSS 对象备份与恢复方案。
2. 核对 images.json 的 `pushed` 与 `remoteDigestVerified` 均为 true，独立确认仓库摘要一致。测试和生产使用同一摘要，禁止重新构建同名版本替换已验镜像。
3. 在 UAT 安排维护窗口，停止全部 API、旧/新 export-worker 及其他写入者。DBA 确认实际 V053 后只执行 `dba/upgrade-v053-v054.sql`；实际 V049 先另取仓库 `deploy/dba/generated/upgrade-v049-v053.sql` 及 manifest，核验 V053，再执行本包 V054。其他版本由 DBA 先选择正确的有序路径。DDL 可能隐式提交，遇错立即停止，不使用 `--force`。
4. DBA 核验 `deployment_schema_history` 最大版本 V054、`PAUSED` 约束、`last_progress_at` 回填以及既有任务和 worker 行保留。回填只表示原更新时间，不代表能够追溯原真实成功批次时间。新空库另取仓库 `deploy/dba/generated/fresh-install.sql` 及 manifest，正式业务数据重新导入，不复制本地数据卷；已有环境不执行空库安装。
5. 保持 test/prod 的 Flyway、历史启动迁移、演示初始化和自动管理员创建关闭，保留原业务密钥、安全 Cookie、UTC 和普通 DML 账号。无新增 Java 迁移；V037 对空库无数据可处理，对历史已有库仍须 DBA 单独审核原 Java 清理，不能由应用自动执行或伪造迁移历史。
6. 审核补丁及 worker 清单。先在目标 namespace 做 server-side dry-run，再于维护窗口更新配置、全部后端/worker 和前端，恢复记录的副本数（当前规划 API 4、前端 2、worker 1）。维护期间不要混跑新旧版本；旧 worker 不维护新进度字段。ConfigMap 环境变量在新 Pod 创建时生效。

```sh
kubectl config current-context
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE patch deployment frontend --type=strategic --patch-file=frontend.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE apply --dry-run=server -f export-worker.yaml
# DBA 升级完成、团队审核 dry-run 后，于维护窗口执行：
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json
kubectl -n TARGET_NAMESPACE apply -f export-worker.yaml
kubectl -n TARGET_NAMESPACE patch deployment frontend --type=strategic --patch-file=frontend.patch.json
# 恢复实际记录的副本数后检查：
kubectl -n TARGET_NAMESPACE rollout status deployment/backend --timeout=300s
kubectl -n TARGET_NAMESPACE rollout status deployment/export-worker --timeout=300s
kubectl -n TARGET_NAMESPACE rollout status deployment/frontend --timeout=300s
```

已有订单应逐活动执行 summary check，需要时 repair 后再次 check，差异必须为 0；命令与数据库权限要求见仓库 `deploy/dba/README.md`。新空库没有历史业务数据，完成管理员初始化后由业务导入正式数据。

## 验收与预算

清理参数默认 `ACTIVITY_DELETION_BATCH_SIZE=500`、`ACTIVITY_DELETION_MAX_RETRIES=5`、`ACTIVITY_DELETION_BATCH_INTERVAL_MS=500`，分别允许 1～1000、1～20、至少 100ms；增加 API 副本不会提高全局清理批次并行度。共享会话、Redis 事件广播、数据库任务领取和锁机制继续保留，支持人工扩缩容，无 HPA。

每 API 业务池 20，复制专用池另最多 1，worker 两池合计 2：4 API+1 worker 常态预算 86；滚动同时 5 API 为 107，另计终止中 Pod、DBA、监控与维护连接。worker 扩容每增加 1 副本再预算 2 个连接及独立临时磁盘；任务仍由共享数据库租约协调。

真实 PolarDB DDL/执行计划、OSS 读写/复制/删除、Redis TLS/Lua、Ingress HTTPS/缓存、混合场景 HTTP 性能、实际多 Pod 和手动扩缩验收均为待执行。云配置启动验证使用本机替代服务和模拟 OSS 地址，不等同于云资源验收。

部署后重点检查：长时间导出不再误报 EXPORT_STOPPED，失败的旧任务须重新创建；暂停后跨副本停止领取，继续后沿原进度完成；排除已中奖客户的 preview/draw 耗时及请求日志；不同客户审核可并行，同客户与调价/归档仍受正确保护。要求旧页面刷新到配套新前端。

## 回退

遇错先停止写入和新任务、保留日志及升级后数据，由团队与 DBA 决定应用/数据库/对象恢复。20261105.1 不理解 PAUSED 和新进度语义；回退前先处置 PAUSED 任务并停止全部执行者，不能只替换镜像继续运行。本包不提供破坏性降级 SQL。永久删除已移除的对象只能依靠 OSS 对象恢复方案，SQL 备份不能恢复对象。
