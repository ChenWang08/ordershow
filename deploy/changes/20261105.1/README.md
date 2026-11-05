# ACK 20261105.1 部署团队交付包

本机镜像构建及隔离验收已完成。同步 main 5aa082b，保留 ebe891b；镜像源码 c48e69c7d877c9d137df0dfecea0681c14866be8。2026-11-05 前后端均已上传 CODING，并独立核验远端摘要与交付记录一致、运行平台为 linux/amd64；没有执行云端部署。前后端为两份镜像，export-worker 与 API 使用同一份后端镜像。

## 文件

- images.json：本机标签、CODING 标签、本地 ID、源码及已独立核验的远端摘要。部署时须核对仓库摘要仍与清单一致，并将 API、worker 同时固定为该后端摘要。不能把本地 ID 自动当作已验证的远端摘要。
- backend.patch.json / frontend.patch.json：仅更新现有 Deployment 中对应容器的镜像，保留实际地址、Secret、资源与其他容器。默认部署/容器名为 backend、frontend，团队先与目标核对。
- configmap.patch.json：仅合并已列出的非秘密参数；不含真实地址或密钥。目标为 order-show-config。部署显式 env、Secret 或启动参数若覆盖这些值，团队需一并处理。
- export-worker.yaml：新建 1 副本导出进程，0.5 CPU/512Mi、256Mi Java 堆、2Gi 磁盘 emptyDir、1Gi 临时导出预算，非 root、只读根目录。引用现有 order-show-config / order-show-secrets；按目标配置相同 namespace、拉取权限和网络策略。无需 Service/Ingress，也没有 HTTP 健康接口。
- ../../dba/generated/upgrade-v049-v053.sql：仅用于现有 V049；fresh-install.sql 仅用于空库。manifest 记录校验和。数据库实际版本不同必须先选择正确的有序路径。
- verification/：本轮通过结果、条件跳过数量及首轮连接失败记录。

## 团队发布顺序

1. 确认目标集群、namespace、数据库实际版本，保存当前镜像摘要、配置及 Deployment（含实际副本数）；核实数据库和 OSS 对象备份/恢复方案。保留 20261102.1 镜像。
2. images.json 中两份 CODING 标签均已推送成功并独立核验远端摘要及 linux/amd64。发布前复核仓库摘要仍与清单一致；测试和生产提升同一摘要，API 与 worker 必须一致。
3. 在 UAT 安排停写/停任务维护窗口，停止旧 API 和 worker；DBA 备份、执行对应升级包，遇错即停。到 V053 后逐活动 summary repair/check，差异应为 0。不得由应用 Flyway 或 initContainer 代替 DBA 升级。
4. 检查云端 profile 为 test 或 prod，安全 Cookie、UTC、旧业务密钥均保留。审核 OSS GetObject/PutObject/DeleteObject，以及复制源读、目标写权限；共享 Redis 必须支持所用 Lua 原子操作。
5. 用下面的参数及镜像补丁更新现有资源，审核并应用 worker 清单，恢复 API 到记录的副本数（当前计划 4），worker 1；就绪及功能验收后更新前端 2 副本并要求旧页面刷新。示例只能由团队在填好 TARGET_NAMESPACE 后执行：

```sh
kubectl config current-context
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json --dry-run=server
kubectl -n TARGET_NAMESPACE apply --dry-run=server -f export-worker.yaml
# 审核 dry-run 后，在维护窗口执行实际更新：
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json
kubectl -n TARGET_NAMESPACE patch deployment backend --type=strategic --patch-file=backend.patch.json
kubectl -n TARGET_NAMESPACE apply -f export-worker.yaml
# 恢复 API 后检查；实际原副本数由团队确认：
kubectl -n TARGET_NAMESPACE scale deployment/backend --replicas=4
kubectl -n TARGET_NAMESPACE rollout status deployment/backend --timeout=300s
kubectl -n TARGET_NAMESPACE rollout status deployment/export-worker --timeout=300s
kubectl -n TARGET_NAMESPACE patch deployment frontend --type=strategic --patch-file=frontend.patch.json
kubectl -n TARGET_NAMESPACE rollout status deployment/frontend --timeout=300s
```

ConfigMap 环境变量仅在新 Pod 创建时生效；如果镜像摘要已相同，团队仍需安排受控重建 API/worker。模板不覆盖现有 API 资源与副本；本次预算按 4 个 API 的每副本业务池 20、复制池另 1，加 worker 2：常态 86；滚动 5 API 时 107，另计终止 Pod、维护和监控。

6. 验收共享会话、上传/图片 304、下单幂等、21 列导出、复制、归档、永久删除、worker 重启恢复和任务监控。worker startupProbe 仅检查进程与 /tmp 权限，不代表任务能完成；还需观察队列、租约、失败与耗时。真实 PolarDB、Redis TLS/Lua、OSS、Ingress HTTPS/缓存行为和持续高峰容量仍须 UAT 验证。

## 回退

保存升级前的真实镜像摘要、配置和副本数。遇错先停止写入及新任务，保留日志；由团队和 DBA 决定恢复应用、数据库及对象。旧版本不理解本轮新功能，不能仅替换旧镜像撤销升级；永久删除已移除的 OSS 对象必须依靠对象备份/版本恢复，SQL 备份不能替代。数据库按经审核的备份恢复方案处理，本包不提供通用破坏性降级 SQL。

## 本机测试边界

前端 482 项通过；后端去重 488 项：329 通过、159 条件跳过、0 失败。真实 MySQL outbox 6/6、V049→V053 升级与空库结构对照、四副本 167 项 HTTP、共享 Redis、真实镜像页面和中断恢复通过。短时合成负载为 1000 个逻辑读取客户端、30 个持续写入客户端（约每 4 秒一次）、30 人同时提交及并行 20 万明细导出；最终 480 次写入和对账通过，不代表云端容量。

首轮有 9 次客户端 fetch 连接失败，入口未见 5xx；改用明确的 127.0.0.1 后复测通过，首轮未采集底层异常原因，不能据此确定根因或把首轮算通过。中间复测遗漏合成版本绑定，补齐后重跑。页面初次登录因测试 PUBLIC_ORIGIN 未配置被拒绝，已补齐隔离入口；未修改生产安全校验。完整通过证据和首轮失败记录一并保留。
