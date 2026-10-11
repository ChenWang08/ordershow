"use client";

import { ImportTemplateDownload, ImportTemplateHint } from "./ImportTemplateDownload";

import { whitelistCustomerTypeMode, type WhitelistRow } from "../../domain/import-domain";
import type { ActivityStatus } from "../shared/types";
import { CustomerWhitelistTable } from "./whitelist/CustomerWhitelistTable";
import type { ImportTaskIds } from "./product-module-types";
import type { useWhitelistImport } from "./useWhitelistImport";
import type { useWhitelistEditor } from "./useWhitelistEditor";

type WhitelistPageProps = {
  activityStatus: ActivityStatus;
  whitelistRows: WhitelistRow[];
  whitelistImportCompleted: boolean;
  serverImportBlocking: ImportTaskIds;
  whitelistImport: ReturnType<typeof useWhitelistImport>;
  whitelistEditor: ReturnType<typeof useWhitelistEditor>;
};

export function WhitelistPage({
  activityStatus, whitelistRows, whitelistImportCompleted, serverImportBlocking, whitelistImport, whitelistEditor,
}: WhitelistPageProps) {
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const baseDataReadOnly = activityStatus === "scheduled" || activityClosed;
  const whitelistMode = whitelistCustomerTypeMode(whitelistRows);
  const { whitelistFileName, whitelistImportWarnings, whitelistImportError, whitelistSheetCounts, whitelistImportInputCount, whitelistImportStats, beginWhitelistImport, cancelWhitelistImport, confirmWhitelistImport, handleWhitelistFile } = whitelistImport;
  const { openWhitelistForm, setEditingWhitelistRow, deleteWhitelistRows } = whitelistEditor;
  const parsedWhitelistCount = whitelistFileName ? whitelistImportInputCount : 0;
  const removedWhitelistCount = Math.max(0, parsedWhitelistCount - whitelistImportStats.total);
  return (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{whitelistImportCompleted ? "当前客户白名单" : "客户白名单导入"}</h2><p>{whitelistImportCompleted ? "当前数据来自最近一次确认的完整 Excel；发布活动后锁定" : "上传完整白名单 Excel，浏览器解析后替换当前白名单"}</p></div><div className="panel-actions"><ImportTemplateDownload kind="whitelist" /><button className="secondary-button" disabled={baseDataReadOnly || (!whitelistImportCompleted && (!whitelistFileName || Boolean(whitelistImportError)))} onClick={openWhitelistForm}>＋ 手动添加客户</button>{whitelistImportCompleted && <button className="admin-primary" disabled={activityPublished} onClick={beginWhitelistImport}>重新导入 Excel</button>}</div></div>
            {!whitelistImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityPublished ? "活动已发布，白名单 Excel 已锁定；待开始状态可先撤回发布再修改。" : "每次白名单 Excel 都是一套独立完整名单，不展示新增、更新或移除差异。上传只生成预览，点击确认且保存成功后才整体替换当前白名单；只读取一个非空 Sheet，客户类型列可全部填写或全部留空；同一客户类型下手机号必须唯一，不同客户类型可以使用相同手机号。"}</span></div>}
            {!whitelistImportCompleted && <ImportTemplateHint />}
            {!whitelistImportCompleted && <div className="single-upload-grid">
              <article className={"file-upload-card " + (whitelistFileName && !whitelistImportError ? "ready" : "")}>
                <div className="file-card-heading"><span>XL</span><div><b>客户白名单 Excel</b><small>统一文件 · 读取 1 个非空 Sheet，名称不限</small></div><em>{whitelistFileName ? (whitelistImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {whitelistFileName ? <p title={whitelistFileName}>{whitelistFileName}</p> : <p>尚未选择白名单 Excel 文件</p>}
                <div className="sheet-tags"><span>任意 Sheet（仅允许 1 个非空）</span><span>客户类型列可全部填写或全部留空</span><span>不再要求经销商类型列</span></div>
                <footer><small>{activityPublished ? "活动已发布，Excel 导入已锁定" : whitelistFileName && !whitelistImportError ? `识别 ${parsedWhitelistCount} 名客户 · ${whitelistMode === "UNSPECIFIED" ? "不区分客户类型" : "按客户类型"}` : "必须包含客户类型、分公司、经销商全称和经销商电话等字段"}</small><div>{whitelistFileName && <button type="button" disabled={activityPublished} onClick={cancelWhitelistImport}>移除</button>}<label className={activityPublished ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityPublished} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWhitelistFile(file); event.currentTarget.value = ""; }} />{whitelistFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
            </div>}
            {!whitelistImportCompleted && whitelistFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{whitelistImportError ? "文件解析失败" : "Excel 预览完成 · 等待确认替换"}</b><small>{whitelistImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedWhitelistCount} 名、已移除 ${removedWhitelistCount} 名、待发布 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名、待处理 ${whitelistImportStats.pending} 名`}</small></p><strong>{whitelistImportStats.total} 名待发布</strong></div>{whitelistImportError && <div className="warning-box"><b>文件无法导入</b><span>{whitelistImportError}</span></div>}{!whitelistImportError && whitelistImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{whitelistImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!whitelistImportError && <><div className="sheet-counts">{whitelistSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布客户", whitelistImportStats.total], ["有效", whitelistImportStats.valid], ["待处理", whitelistImportStats.pending]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} onDelete={deleteWhitelistRows} /><button className="admin-primary wide" disabled={!whitelistImportStats.total || activityPublished || whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0} onClick={confirmWhitelistImport}>{whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0 ? `请先处理 ${Math.max(whitelistImportStats.pending, serverImportBlocking.WHITELIST ?? 0)} 条待处理白名单` : `确认替换当前白名单 ${whitelistImportStats.total} 名`}</button></>}</div>}
            {whitelistImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次白名单替换完成</b><small>{activityClosed ? "活动已截止，白名单数据只读。" : activityStatus === "scheduled" ? "活动已发布，白名单已锁定；如需修改请先撤回发布。" : activityStarted ? "活动已开始，白名单 Excel 导入已锁定；紧急修改单条客户会记录操作日志。" : "当前白名单来自最近一次确认的完整 Excel；重新导入后以新文件为准，历史订单不会被删除。"}</small></p><div><strong>{whitelistRows.length}</strong><small>客户总数</small></div><div><strong>{whitelistRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{whitelistRows.filter((row) => row.status === "待处理").length}</strong><small>待处理</small></div></div><div className="data-section-title"><div><b>当前客户白名单</b><span>{whitelistFileName} · {whitelistMode === "UNSPECIFIED" ? "不区分客户类型" : "综合客户和特渠客户"}共 {whitelistRows.length} 名 · {activityClosed ? "活动已截止，只读" : activityStatus === "scheduled" ? "活动已发布，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} allowDeleteAll={!activityPublished} onDelete={deleteWhitelistRows} /></>}
          </div>
  );
}
