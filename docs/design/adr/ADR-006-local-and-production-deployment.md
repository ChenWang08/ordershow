# ADR-006：本地优先、基础设施接口可替换

- 状态：已接受
- 日期：2026-08-20

## 决策

开发阶段由 Docker Compose 启动统一 React 前端、Spring Boot 后端、MySQL、Redis 和 MinIO；Flyway 当前随后端启动执行。正式云厂商、域名和服务器型号暂不锁定；所有连接和密钥通过环境配置注入。

## 当前本地实现

- 一个 Spring Boot 进程同时提供 API 并执行导入/调度任务；
- MySQL 保存业务事实，Redis 提供缓存与锁，MinIO 保存导入文件和商品图片；
- 该形态用于本地开发、联调和功能验收，不代表生产高可用已经完成。

## 生产约束

- 对象存储通过 S3 兼容接口封装；
- 文件数据库记录保存对象键，不保存厂商完整 URL；
- local、test、staging、production 使用独立数据库、Redis 和对象存储桶；
- 正式入口使用托管 LB/WAF/CDN，由云厂商负责入口高可用；不把单台 Nginx 作为 HA 入口。Nginx 只用于本地开发或实例内反向代理；
- 正式环境至少两个 API 实例和一个独立 Background Worker 运行角色，Worker 使用 MySQL DB Task Queue 执行导入、导出、outbox 和调度任务；
- Flyway 由发布流水线中的独立 Migration Job 执行一次，API/Worker 启动不负责数据库升级，运行账号不具备 DDL 权限；
- 正式环境执行数据库恢复和 2 倍峰值压力测试。
