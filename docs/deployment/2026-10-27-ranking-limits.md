# 订货排行 90/30 修复与已有活动处理（2026-10-27）

## 问题和最终规则

数据库和原设计默认为公司前 90 名、分公司前 30 名，但前端创建活动曾写死传入 20/20，后端如实保存。排行查询按活动上限返回，历史活动又读取已保存快照，因此“第三次测试”22 个有效提交客户只显示 20 个。

- 新建活动明确传入 90/30；后台限制合法范围为 1–500，拒绝 0、负数和超范围值。
- 独立订货排行金额/吨数、全部客户/特渠/综合各大区统一先筛选再排序，不足上限全部展示，超过才截取。显式自定义上限继续保留。
- 页面按返回的公司数量分三列。订单综合看板两个 TOP 15 卡片保持前 15 名；顶部全量金额和有效订单数不截断。
- 修正窄窗口原来隐藏后两列客户及分公司榜的问题；改为纵向排列并滚动查看，大屏布局不变。
- 筛选后只有 1–2 名客户时，只生成实际有数据的列，避免出现“2–1”“3–1”的空列范围。
- 吨数榜不把“缺失系数、吨数 NULL/0”的占位值当作已计算吨数。有效系数对应的已保存吨数（包括实际舍入为 0）及历史正吨数参与计算；部分可计算则汇总可计算部分。金额榜不因此排除客户。
- 不更改正式订单、订单明细、订单版本、审核申请、草稿和商品系数。

## 代码与测试

- `app/services/api/activity.ts`：创建活动由 20/20 改为 90/30；修改活动仍保留已保存的自定义上限。
- `ActivityController`：排行人数校验 1–500。
- `app/styles/responsive.css`：窄窗口保留全部排行列与分公司榜。
- `RankingBoard`：不渲染少量客户时的空排行列。
- `DashboardService`：仅吨数排行修正缺失吨数的识别；金额与全量统计保持原口径，不重算订单。
- Node 行为/渲染测试和 Java 真实 MySQL 查询测试覆盖创建、22 人完整显示、90/91 边界、两种排序、筛选、分公司 30、自定义配置、无可计算吨数和历史快照。

运行入口见 [测试说明](../../tests/README.md)。

## 部署顺序

1. 备份数据库和旧镜像，预览目标环境各活动的上限和有效提交数。
2. 构建并更新前后端；在处理旧活动期间暂停旧后端，避免重新写入旧快照。
3. 仅对核实由旧默认产生的 20/20 活动执行下方名单式修正；不以“值为 20”直接推断所有活动都需要修改。若已有自定义 20/20，必须从名单排除。
4. 对本次已修正的 `FINISHED` 活动，失效金额、吨数和 REPORT 展示快照；另失效 `FINISHED` 的旧吨数排行快照，让新算法生效。`ARCHIVED` 冻结数据不自动处理。
5. 启动新后端，访问各活动两种排行、全部/特渠/综合各大区及订单综合看板，重建快照并核对人数、金额和吨数。历史页不会持续轮询，已打开的页面需要刷新。

**没有新增 Flyway 迁移，也没有应用启动时自动批量修数据。** 数据库版本仍为 V039。更新镜像只影响以后新建活动和新计算的排行，旧配置和缓存快照必须在目标环境独立处理。本地数据库不会随 Git 提交或镜像复制到服务器。

## 已有活动的受控 SQL

先只读预览：

```sql
SELECT a.id, a.activity_code, a.name, a.status, a.version,
       a.company_ranking_top_n, a.branch_ranking_top_n,
       COUNT(o.id) submitted_orders, COALESCE(SUM(o.total_amount), 0) amount
FROM activity a
LEFT JOIN customer_order o ON o.activity_id = a.id AND o.status = 'SUBMITTED'
GROUP BY a.id ORDER BY a.id;
```

备份、核实名单并暂停后端后，在同一数据库连接执行以下模板。**临时名单初始为空，不会自动选择活动；只填目标环境已确认的 ID，不能照抄本地 ID。**

```sql
SET time_zone = '+00:00';
CREATE TEMPORARY TABLE ranking_repair_targets (
  activity_id BIGINT UNSIGNED PRIMARY KEY,
  expected_version INT UNSIGNED NOT NULL
);

-- 核实后逐项填入 ID 和预览时的 activity.version，例如：
-- INSERT INTO ranking_repair_targets VALUES (<确认的活动ID>, <当前version>);

START TRANSACTION;
UPDATE activity a JOIN ranking_repair_targets t ON t.activity_id = a.id
SET a.company_ranking_top_n = 90, a.branch_ranking_top_n = 30,
    a.version = a.version + 1, a.updated_at = UTC_TIMESTAMP(3)
WHERE a.company_ranking_top_n = 20 AND a.branch_ranking_top_n = 20
  AND a.version = t.expected_version AND a.status <> 'ARCHIVED';

-- 只清理本次成功修正活动的可再生展示快照。
DELETE s FROM activity_dashboard_snapshot s
JOIN ranking_repair_targets t ON t.activity_id = s.activity_id
JOIN activity a ON a.id = s.activity_id
WHERE a.status = 'FINISHED' AND a.version = t.expected_version + 1
  AND a.company_ranking_top_n = 90 AND a.branch_ranking_top_n = 30
  AND (s.snapshot_key LIKE 'RANKING:%' OR s.snapshot_key LIKE 'RANKING_TONS:%' OR s.snapshot_key = 'REPORT');

-- 吨数算法对所有 FINISHED 活动生效，不覆盖 ARCHIVED 冻结数据。
DELETE s FROM activity_dashboard_snapshot s JOIN activity a ON a.id = s.activity_id
WHERE a.status = 'FINISHED' AND s.snapshot_key LIKE 'RANKING_TONS:%';
COMMIT;
DROP TEMPORARY TABLE ranking_repair_targets;
```

提交事务前应确认 UPDATE 的实际行数与名单一致；不一致应回滚并重新核对。第二次执行不会重复修改已经是 90/30 的活动；快照下次访问由新后端按正式有效订单重新生成。仅涉及展示配置和派生快照，不修改历史订单记录。

## 回退

停止本地新后端，使用更新前镜像，并从备份定向恢复本次活动的排行字段、配置版本和受影响的 `activity_dashboard_snapshot`。若修复后已经产生其他业务操作，不能整库覆盖恢复；需先核对后续变更。

本次本地完整备份：`backups/ranking-20261027-before/order_show.sql`（Git 忽略，不随代码提交）。

## 本地验收

- 前端生产构建、246 项 Node 测试、类型检查和 ESLint 通过。Java 全量 197 项，166 通过、31 按环境跳过，其中排行真实数据库专项 10 项全部通过。未运行完整隔离 API E2E，不将这些跳过项计为通过。
- 104 个本地接口组合对照实际 `SUBMITTED` 订单核对通过，包括两种排行、全部/特渠/综合及各大区；各历史活动的 REPORT 也已访问并核对。
- 实际浏览器验证“第三次测试”两种口径 × 5 个界面筛选，共 10 种组合。1440px 下保留三列及分公司榜；640px 下三列依序纵向排列，分公司榜可见，完成后恢复原浏览器尺寸。单客户大区只显示实际有数据的列。

| 第三次测试范围 | 金额榜客户数 | 吨数榜客户数 |
| --- | ---: | ---: |
| 全部客户 | 22 | 21 |
| 特渠专业客户 | 13 | 12 |
| 综合南区 | 4 | 4 |
| 综合东区 | 1 | 1 |
| 综合北区 | 4 | 4 |

金额仍为 **1,416,708.80 元**，总吨数仍为 **35.151003 吨**。洛阳粲然商贸有限公司的 4,000 元有效订单缺少吨箱换算数据，在金额榜保留，在吨数榜按已确认规则排除。没有改商品系数，也没有补造该订单吨数。

已核对的本地旧默认活动 ID：3、4、5、6、7、8、9、10、11、12。均从 20/20 修正为 90/30 并递增活动配置版本；ID 1 的 90/30 和配置版本保持原值。失效本次修正活动的 85 份派生快照，另失效 ID 1 的 1 份旧吨数快照；已通过新后端重建相应排行和 REPORT。原数据库无 ARCHIVED 活动，未处理归档冻结数据。

完整修复前数据库备份为 61,389,441 字节，SHA-256：`7AF0E8BC4D2B7C12D4D6EEDD346FF458FC3EC1E9D6167515B038FD4E531A63E5`。另对 `customer_order`、`order_item`、`order_version`、`order_version_item`、`order_change_request`、`h5_order_draft` 同选项逐行导出，前后均为 `10C2110023C3BED68F197F23A6EA953A76B2B96F0B2DAE97CF0526D923B1B1F5`，确认业务记录未改变。

本地新镜像（`latest` 同步指向对应版本）：

| 服务 | 镜像 | 镜像 ID 前缀 |
| --- | --- | --- |
| 后端 | `order-show-backend:ranking-20261027` | `0a30ddafb85c` |
| 前端 | `order-show-frontend:ranking-20261027` | `19d92da52be9` |

原镜像保留为 `order-show-backend:before-ranking-20261027`（`2066b74944d8`）、`order-show-frontend:before-ranking-20261027`（`651ad6e53a7a`）。外部 Docker 基础镜像仓库当时无法连接，本地构建复用了已安装运行镜像及依赖，新源码在容器内重新编译；临时构建文件放在 Git 忽略的 `work/ranking-build/`，标准部署 Dockerfile 未修改。Compose 更新时 MySQL、Redis 容器也按当前配置重建，原持久卷保留，业务表哈希核验一致；MinIO 容器保持原样。

本地后端健康 `UP`。数据库仍为 V039，本次代码、测试与文档纳入本地 main 分支提交，尚未推送，没有修改线上服务或线上数据。构建、接口、浏览器、布局和业务完整性证据放在 Git 忽略的 `outputs/ranking-20261027/` 及 `outputs/ranking-*-20261027.log`。

本机截图：`outputs/ranking-20261027/amount-desktop.png`、`tons-desktop.png`、`amount-narrow.png`；不随 Git 提交。
