# 活动写入保护：启动初始化顺序修复

日期：2026-11-03。范围：活动写入拦截器的数据库依赖初始化；未部署业务应用，未修改业务数据库或连接池、Redis参数。

## 问题与修复

连接池对比压测的后端启动日志显示：`meterRegistryPostProcessor` 初始化时发现基础设施级 `activityWriteAdvisor`，其直接依赖 `ActivityAccessPolicy` 和 `PlatformTransactionManager`，连带提前创建 JdbcTemplate、Flyway和数据源。Hikari先启动，随后绑定 `spring.datasource.hikari.connection-init-sql` 时抛出：

```text
The configuration of the pool is sealed once started.
```

该问题在启动阶段触发，与是否点击归档、删除无关。上一轮生命周期测试预先构造了数据库组件，未覆盖正式Spring Boot配置绑定及监控组件的初始化链。

修复仅给 `activityWriteAdvisor` 的两个依赖参数加 `@Lazy`，创建Advisor时注入延迟代理，实际使用时再解析依赖。保留基础设施Advisor角色、匹配范围、状态判断、事务隔离级别、锁、草稿/导入的独立事务边界以及只读导出例外。

## 回归检查

新增 `ActivityWriteStartupTest`：

- 加载正式 `application.yml`，组合真实Spring Boot数据源、配置绑定、事务、Flyway和监控自动配置；不使用预先构造的连接池。
- 通过末阶段BeanPostProcessor检查活动策略、事务管理器、JdbcTemplate和数据源均经过完整处理，防止Advisor发现阶段再次过早创建依赖。
- 两组测试配置分别为最大连接4/最小空闲1/等待750ms，以及最大连接8/最小空闲2/等待1500ms，仅作用于临时测试池。
- 核对连接池参数、UTC会话初始化、JDBC属性、Hikari监控指标和真实事务查询；固定连接33326端口临时库，不读取业务数据库配置。

修复前，两组初始化阶段检查均失败，确认上述四个组件跳过了末阶段处理器；原压测日志记录的具体Hikari sealed异常作为实际故障证据。初版仅检查启动和属性的用例曾通过，因此补上了初始化阶段检查，不能将原本的“能启动”视为缺陷已覆盖。

扩展 `ActivityLifecycleIntegrationTest#controllerAdvisorEnforcesArchiveAndDeletionAndRollsBackBusinessFailure`，通过真实Spring代理和MySQL验证管理端及H5写入路径的失败回滚、正常写入，以及归档/删除后的拒绝。H5路径使用测试业务探针检查拦截器，不冒充完整登录与下单端到端测试。

同时复测原有草稿重试/导入失败留痕数据库用例、订单提交写入路径和草稿事务专项；不扩大为全系统回归或性能压测。

修复后的执行结果：

| 专项 | 通过数 | 结果 |
| --- | --- | --- |
| ActivityWriteStartupTest | 2 | 两组启动、完整初始化处理、配置绑定、UTC、Hikari指标及事务查询通过 |
| ActivityLifecycleIntegrationTest指定方法 | 2 | 管理端/H5路径写入、回滚、归档及删除拦截，草稿和导入事务兼容通过 |
| OrderSubmitWritePathTest | 9 | 订单提交与版本写入专项通过 |
| DraftSaveTransactionsTest | 4 | 草稿事务、重试及不确定提交边界通过 |
| 合计 | 17 | 0失败、0错误、0跳过 |

本次独立库执行当前源码全部52个迁移至V052；修复本身没有新增迁移。Java正式源码与测试编译通过，文档及补丁格式检查通过。

## 复跑与证据

使用[生命周期验证记录](activity-lifecycle-2026-11-03.md)中的独立临时MySQL启动方式，数据库为 `order_show_activity_lifecycle_test`；只允许 `ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only` 开启。生命周期用例会重建这个固定测试库，禁止与同库测试并行。

```powershell
docker run --rm --memory 1536m --cpus 2 `
  -e ORDER_SHOW_ACTIVITY_TEST=activity-lifecycle-only `
  -v order-show-m2:/root/.m2 -v "${PWD}:/workspace" -w /workspace `
  maven:3.9.11-eclipse-temurin-21 mvn -o -B -ntp -f backend/pom.xml `
  '-Dtest=ActivityWriteStartupTest,ActivityLifecycleIntegrationTest#controllerAdvisorEnforcesArchiveAndDeletionAndRollsBackBusinessFailure+draftRetryAndImportFailureKeepTheirOwnedTransactions,OrderSubmitWritePathTest,DraftSaveTransactionsTest' `
  '-DargLine=-Xmx512m' test
```

修复前后报告位于忽略目录 `outputs/activity-write-startup/before/` 和 `after/`；原压测启动日志保存在同目录的 `benchmark-original-startup.log`。本轮临时库与现有连接池压测库独立，不改动其容器、数据、脚本或参数。验证完成后已停止并自动移除本轮临时MySQL容器，合成库随内存文件系统销毁；测试上下文和连接池均已关闭。

本次没有构建或发布业务镜像，没有启动完整HTTP服务或继续MySQL/Redis对比压测。后续在压测环境采用修复后的构建，再恢复原有比较步骤；测试通过不代表已经部署或完成性能验收。
