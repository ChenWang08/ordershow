# 商品与导入模块边界

## 商品目录与图片

| 模块 | 职责 |
| --- | --- |
| `ProductService` | 对外兼容入口、商品维护、原有事务边界及价格同步调用 |
| `ProductCatalogReader` | H5/后台商品查询、客户范围过滤、版本来源及商品附属信息读取 |
| `ProductImageMatcher` | 图片名称和路径评分、包装冲突判断、候选选择；不读写数据库 |
| `ProductImageService` | 单图维护、候选确认/排除、ZIP 预览与挂载、图片存储关联 |
| `H5CatalogService` / `H5Product` | H5 读取入口、当前身份/目录版本校验及精简返回结构 |
| `H5CatalogDataService` | 一条索引查询读取客户权限上下文；只读一致性事务加载完整或部分商品快照 |
| `H5CatalogCache` | 按活动共用不可变商品/权限快照、合并加载、容量/并发/等待上限及淘汰 |
| `ProductCatalogChanges` / `ProductCatalogRedisBridge` | 事务内目录版本/outbox、提交后各副本缓存更新及恢复 |

后台 Controller 和 DTO 保持兼容；H5 商品读取改用独立精简 DTO。图片操作仍从 `ProductService` 的原有事务入口进入；导入发布中的 ZIP 挂载沿用调用者事务。商品/图片/权限维护与发布先锁活动行，再写业务数据、目录版本和 outbox，统一锁顺序。缓存数据加载单独使用只读 REPEATABLE_READ 事务，等待缓存的请求不持有加载事务。图片名称、阈值、候选判定和同名商品共享图片规则未改变。

`ProductCatalogReader` 继续提供后台结构和缓存关闭/带服务端筛选参数时的原 SQL 路径；附属信息按 500 个商品一批读取。缓存命中时只读一条客户/绑定/目录版本上下文查询。冷加载等待后或缓存版本先于上下文推进时重新读取上下文，避免把新目录规则与旧客户权限混用。MySQL 的大小写/重音比较通过同库排序权重保留，不能仅用 Java 字符串相等代替。

## Excel 解析与预览

1. `ImportWorkbookReader` 每次读取使用独立的 formatter 和结果缓冲，解析商品、白名单或到场工作簿。
2. `ParsedWorkbook` 保存汇总信息及有序的预览行/问题记录，不执行数据库写入。
3. `ImportStagingWriter` 按原先的行与问题记录顺序持久化，敏感字段在写入前加密。
4. `ImportPreviewValidator` 负责用户编辑、删除预览行后的复核；`ImportWorkbookRules` 保存原有字段与判重规则。
5. `ImportWorkbookProcessor` 保留原有调用接口，组织读取、写入和复核。解析或持久化异常仍由原先的上传事务处理。

Reader 可以在没有数据库及存储服务的情况下测试。解析结果中的敏感值仅供内部持久化使用，不作为接口返回内容；预览 JSON 继续使用脱敏值。

## 导入发布

`ImportService` 保留任务上传、确认、取消、任务领取和失败状态处理。定时任务领取成功后，仍通过原有 `TransactionTemplate.executeWithoutResult` 调用 `ImportPublisher`。

`ImportPublisher` 负责创建发布版本、调用数据写入、挂载图片、切换活动绑定、退休旧版本和完成任务。写入按业务分为 `ProductImportWriter`、`WhitelistImportWriter`、`AttendanceImportWriter`；任务读取和通用发布数据读取归入 `ImportTaskRepository`，内部数据与转换分别位于 `ImportData` 和 `ImportValues`。

三类 writer 不创建独立事务。数据库写入和活动绑定切换仍处在同一发布事务内；失败后由外层记录 `FAILED/PUBLISH_FAILED`，并允许按现有规则重新确认。对象存储的既有生命周期策略没有在本轮修改。

## 验证与限制

- 商品、发布、工作簿三个原模块的 49 段 SQL 文本块与拆分后逐一对比一致。
- 新增 Reader 独立解析、记录顺序、批次隔离、损坏文件和敏感数据持久化测试。
- 新增图片 ZIP 只读预览和空图片包错误码测试。
- 新增 API E2E：先发布正常目录，再以损坏 ZIP 触发替换失败，确认当前目录未变化；对同一任务重试后发布成功。
- 不修改前一轮发现的客户名称标准化差异；该问题仍单独记录在回归报告中。
