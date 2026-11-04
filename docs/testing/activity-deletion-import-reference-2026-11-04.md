# 活动永久删除：到场导入版本引用修复

日期：2026-11-04。范围：活动删除工作器的第31阶段及相关数据库回归；不部署业务应用，不连接或修改业务数据库。

## 原因

到场导入任务的 `import_task.match_base_version_id` 引用白名单发布版本，受 V007 的 `fk_import_task_match_base_version` 外键保护。原工作器先删除 `import_publish_version`、后删除 `import_task`，遗漏了解除前述引用，因此处理过到场导入的活动可能一直停在第31阶段。`import_publish_version.source_import_task_id` 又引用导入任务，单纯交换删除顺序也不能解决。

重试只重置任务状态、重试次数和等待时间，不改变已经提交的阶段；已删除批次不回滚。网络请求返回200也不代表后台删除已经完成。

## 修复方式

- 保留 `STEPS` 顺序、第31阶段、后续文件阶段和完成阶段的编号，不新增数据库迁移。
- 在原发布版本阶段，先分批将当前活动导入任务对当前活动发布版本的 `match_base_version_id` 设为NULL，每批最多使用现有 `batch-size` 上限。
- 有引用被解除时，本批只提交解除结果，停留在原阶段；后续确认没有这类引用后才执行原来的限量删除。
- 解除引用不计入 `deleted_rows`；计数仍代表实际删除的行数。事务、数据库协调锁、超时和批间隔沿用原实现。
- 同时限定任务和版本所属活动，不修改其他活动的导入任务。如果其他活动仍引用目标版本，保持外键开启，让任务安全失败，不能自动清除其他活动的引用。
- 已失败的第31阶段任务可以直接由原重试接口继续；不要求重建删除任务或手工修改业务数据。

## 回归范围

`ActivityLifecycleIntegrationTest`：

1. 原1201条订单明细的完整分批删除场景增加白名单发布版本和到场导入引用，验证从头删除、重启续跑、文件清理和其他活动逐表隔离。
2. 新增失败阶段续跑场景：固定第31阶段；真实外键先拒绝删除被引用的白名单版本；模拟既有FAILED任务后通过原重试接口恢复；5条引用以每批2条分三批解除，每批更换工作器验证已提交进度，期间版本和删除计数保持不变，最终完成全部清理。
3. 新增跨活动引用场景：其他活动引用目标版本时，其他活动全部导入任务及关联数量保持不变，目标删除在第31阶段失败且不进入文件清理；由测试夹具解除跨活动引用后，原任务重试完成。

仅对照任务和版本所属活动进行清理；跨活动引用场景是异常数据保护测试，不代表正常业务允许建立这种关联。

## 执行结果

修复前，在增加真实到场引用的完整分批删除用例中复现同一错误：`DELETE FROM import_publish_version WHERE activity_id=? LIMIT ?` 被 `fk_import_task_match_base_version` 拒绝。该次实际执行1项、失败1项、错误0项、跳过0项，确认回归用例能够捕获原缺陷。

修复后最终同次整组执行结果：

| 测试类 | 实际执行 | 失败 | 错误 | 跳过 |
| --- | --- | --- | --- | --- |
| ActivityLifecycleIntegrationTest | 14 | 0 | 0 | 0 |
| StorageDeletionTest | 2 | 0 | 0 | 0 |
| 合计 | 16 | 0 | 0 | 0 |

14项数据库用例包括原12项及新增2项，使用独立MySQL 8.4，执行当前源码全部53个迁移至V053（含V037 Java迁移），外键始终开启。原有归档、权限、活动写入拦截、事务回滚、文件故障恢复及多实例协调用例也通过。文件对象服务使用替身。

新增的两个隔离断言初版使用普通Map相等比较，将内容一致的二进制摘要数组按对象身份判为不同；改为递归内容比较后，重新执行完整16项，全部通过。对应中间报告保留，没有将失败或跳过的测试计为通过。

修复前、断言修正前和最终报告分别位于忽略目录 `outputs/activity-deletion-import-reference/before/`、`before-assertion-fix/` 和 `after/`；最终 `after/summary.json` 同时核对两个类的执行数及失败、错误、跳过均为0。正式源码、测试源码编译和补丁格式检查通过。验证完成后停止并自动移除本轮临时MySQL容器，合成测试库随内存文件系统销毁。

## 复跑

沿用[活动生命周期验证记录](activity-lifecycle-2026-11-03.md)的独立临时MySQL：固定端口33326、数据库 `order_show_activity_lifecycle_test`，不挂载业务数据卷。只有显式设置 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only` 才执行数据库专项；禁止与使用同库的启动或生命周期测试并行。

```powershell
docker run --rm --memory 1536m --cpus 2 `
  -e ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml `
  '-Dtest=ActivityLifecycleIntegrationTest,StorageDeletionTest' `
  '-DargLine=-Xmx512m' test
```

必须核对本轮生成的Surefire报告，确认数据库测试实际执行且Skipped为0；未设置开关时的条件跳过不能视为通过。对象存储使用替身，本轮不验证真实对象存储可用性、不执行整站回归或性能压测。

## 部署后的恢复

修复生效需要将包含本次修改的后端构建发布到所有后端副本。超级管理员在原“删除进度”中对FAILED任务点击“继续清理”，任务从原第31阶段续跑，不重新创建活动或删除任务；仍需等待后续文件清理和最终核验，最终状态以COMPLETED为准。本轮不执行发布或在线任务重试。
