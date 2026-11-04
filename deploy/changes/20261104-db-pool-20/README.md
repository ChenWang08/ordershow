# ACK 后端连接池调整为 20

日期：2026-11-04。按用户本次指定的后端 4 副本准备。

## 目标和范围

| 项目 | 配置 |
| --- | --- |
| 后端副本 | 4，部署前确认是 4 个后端 Pod |
| 每个后端资源上限 | 2 CPU / 4Gi，按用户提供的当前配置记录 |
| 每个后端最大连接数 | 20 |
| 每个后端最小空闲连接 | 本地模板为 2，补丁保留线上现值 |
| 获取数据库连接的等待时间 | 本地代码为 5000ms，本次不调整 |
| 常态应用连接上限 | 4 × 20 = 80 |
| 滚动同时运行 5 个后端时 | 5 × 20 = 100，另计终止中的 Pod 和其他数据库用户 |

包内 `configmap.patch.json` 只修改 `order-show-config` 的 `data.DB_POOL_SIZE`。不会部署旧镜像、替换数据库地址/Secret、执行 SQL、调整副本数或资源。ACK 的连接池由部署时环境变量配置，不需要重建业务镜像。

## 运维操作：现有环境

以下由有权限的运维在目标集群执行。本次交付没有执行这些命令。

1. 确认当前集群、目标 namespace、后端 Deployment 名和实际后端副本数；确认后端引用 `order-show-config`，且没有在 Deployment 的显式 `env`、Secret、`SPRING_APPLICATION_JSON`、启动参数或外部 Spring 配置中覆盖连接池参数。检查数据库连接预算能容纳 80 个常态应用连接及滚动更新、其他应用和维护连接。先在 UAT 做对照压测。
2. 在解压后的补丁目录执行下面命令。`TARGET_NAMESPACE` 必须替换为本次目标环境实际 namespace；不要仅依据旧生产包猜测 UAT 的 namespace。保存的旧值用于参数回退。

```sh
kubectl config current-context
kubectl -n TARGET_NAMESPACE get deployment backend -o jsonpath='{.spec.replicas}'
kubectl -n TARGET_NAMESPACE get deployment backend -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\t"}{.image}{"\n"}{end}'
kubectl -n TARGET_NAMESPACE get configmap order-show-config -o jsonpath='{.data.DB_POOL_SIZE}'
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json --dry-run=server -o jsonpath='{.data.DB_POOL_SIZE}'
```

3. 核对预览为 `20`、实际后端 4 副本且预算允许后，更新参数并滚动重启后端。现有 ConfigMap 通过环境变量注入，修改后已有 Pod 不会自动更新。

```sh
kubectl -n TARGET_NAMESPACE patch configmap order-show-config --type=merge --patch-file=configmap.patch.json
kubectl -n TARGET_NAMESPACE rollout restart deployment/backend
kubectl -n TARGET_NAMESPACE rollout status deployment/backend --timeout=300s
kubectl -n TARGET_NAMESPACE get pods -l app=order-show-backend
```

4. 所有新后端 Pod 就绪后，逐个确认环境变量为 `20`。下面的 Pod 标签沿用本地模板，实际部署若有调整应使用对应标签。不要打印全部环境变量或 Secret。

```sh
kubectl -n TARGET_NAMESPACE get pods -l app=order-show-backend -o name
kubectl -n TARGET_NAMESPACE exec POD_NAME -c backend -- printenv DB_POOL_SIZE
```

环境变量 `20` 是注入检查，还须结合实际生效配置/连接池监控核实 Hikari 最大值为 20，并确认获取连接等待时间没有改变。检查 readiness、数据库错误和等待连接情况；用相同活动、压缩、负载及网络路径对比 products P95、连接池 active/idle/pending、数据库 CPU 和慢查询。本次没有云端权限，实际生效及性能结果均待验证。

## 参数回退

先确认该 ConfigMap 原来的值。如果原来是 `10`，使用 `configmap.rollback-10.patch.json` 按上述相同步骤 patch 并滚动重启；原值不是 `10` 时按保存的实际旧值恢复。回退仅涉及连接池参数，不能用旧交付包覆盖正在运行的镜像或重跑初始化 SQL。

## 本地模板

仓库 `deploy/k8s/apps.yaml` 已记录后端 4 副本、每副本资源上限 2 CPU / 4Gi；`deploy/k8s/configmap.yaml` 与 test/prod 变量示例使用最大 20 / 最小空闲 2。前端模板仍为 2 副本。application-cloud.yml 未注入 `DB_POOL_SIZE` 时仍回退到 10，本地 Compose 默认 60 保留。当前业务镜像无需重建；保留部署团队的实际镜像和环境配置。
