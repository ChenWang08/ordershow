"use client";

import { ImportTemplateDownload, ImportTemplateHint } from "../ImportTemplateDownload";

import { type AttendanceImportDraft, type AttendanceRow, type WhitelistCustomerTypeMode } from "../../../domain/import-domain";
import { AttendanceTable } from "../attendance/AttendanceTable";

export function AttendancePage({ rows, fileName, warnings, sheetCounts, error, activityStarted, activityClosed, pendingImport, importAttemptName, blockingCount, previewLoading, publishing, onFile, onAdd, onEdit, onDelete, onConfirmImport, onCancelImport, customerTypeMode = "TYPED" }: { rows: AttendanceRow[]; fileName: string; warnings: string[]; sheetCounts: Array<{ name: string; count: number }>; error: string; activityStarted: boolean; activityClosed: boolean; pendingImport: AttendanceImportDraft | null; importAttemptName: string; blockingCount: number; previewLoading: boolean; publishing: boolean; onFile: (file: File) => void | Promise<void>; onAdd: () => void; onEdit: (row: AttendanceRow) => void; onDelete: (ids: string[]) => void; onConfirmImport: () => void; onCancelImport: () => void; customerTypeMode?: WhitelistCustomerTypeMode }) {
  const previewRows = pendingImport?.rows ?? rows;
  const displayWarnings = pendingImport?.warnings ?? warnings;
  const displaySheetCounts = pendingImport?.sheetCounts ?? sheetCounts;
  const displayFileName = pendingImport?.fileName || (error ? importAttemptName : fileName);
  const isPending = Boolean(pendingImport);
  const originalCount = pendingImport?.inputCount ?? previewRows.length;
  const removedCount = Math.max(0, originalCount - previewRows.length);
  const comprehensiveCount = previewRows.filter((row) => row.customerType.includes("综合")).length;
  const specialCount = previewRows.filter((row) => row.customerType.includes("特渠")).length;
  const blankTypeCount = previewRows.filter((row) => !row.customerType).length;
  const phoneCount = previewRows.filter((row) => row.contactPhone).length;
  const linkedCount = previewRows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible).length;
  const eligibleCustomerCount = new Set(previewRows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible)
    .map((row) => row.activityCustomerId).filter((id): id is number => id != null)).size;
  const pendingCount = previewRows.filter((row) => row.matchStatus === "PENDING_CONFIRMATION").length;
  const unmatchedCount = previewRows.filter((row) => row.matchStatus === "UNMATCHED").length;
  const unspecifiedCustomerType = customerTypeMode === "UNSPECIFIED";
  return (
    <div className="admin-panel attendance-panel">
      <div className="panel-title"><div><h2>现场到场客户</h2><p>按现场参会名单模板导入；抽奖选择现场到场客户时，现场大屏显示经销商名称。</p></div><div className="panel-actions"><ImportTemplateDownload kind="attendance" /><button className="secondary-button" disabled={activityClosed} onClick={onAdd}>＋ 手动添加到场客户</button></div></div>
      <div className="import-rule-hint"><b>{isPending ? "待确认导入" : activityClosed ? "活动已截止" : activityStarted ? "现场名单维护中" : "导入规则"}</b><span>{isPending ? "Excel 已解析，下面显示的是待导入预览；确认后才会替换当前名单并更新抽奖候选池，可先编辑或删除异常记录。" : activityClosed ? "活动已截止，现场到场名单只读。" : activityStarted ? "订货进行中仍可维护现场到场名单，确认替换后会更新抽奖候选池。" : "现场到场名单独立于订货基础数据，可在活动开始前或进行中导入；确认后更新抽奖候选池。"}</span></div>
      <ImportTemplateHint />
      <div className="attendance-upload-grid">
        <article className={`file-upload-card attendance-upload-card ${isPending ? "pending" : displayFileName && !error ? "ready" : ""}`}>
          <div className="file-card-heading"><span>XL</span><div><b>现场到场客户 Excel</b><small>选择文件后先预览，确认后替换当前名单</small></div><em>{isPending ? "待确认" : error ? "解析失败" : displayFileName ? "解析完成" : "待上传"}</em></div>
          <p title={displayFileName}>{displayFileName || "尚未选择现场到场 Excel 文件"}</p>
          <div className="sheet-counts">{displaySheetCounts.length > 0 ? displaySheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>) : <span>{isPending ? "待导入名单" : "当前名单"}<b>{previewRows.length}</b></span>}</div>
          {error && <div className="warning-box"><b>文件无法导入</b><span>{error}</span></div>}
                <footer><small>{isPending ? `Excel 原始 ${originalCount} 名 · 已移除 ${removedCount} 名 · 待发布 ${previewRows.length} 名` : activityClosed ? "活动已截止，名单只读" : error ? "文件解析失败，请修正后重试" : displayFileName ? `已读取 ${previewRows.length} 名客户` : "支持 .xlsx 文件"}</small><div>{isPending && <button type="button" disabled={publishing} onClick={onCancelImport}>取消导入</button>}{error && !isPending && <button type="button" onClick={onCancelImport}>清除错误</button>}<label className={`file-button ${activityClosed || publishing ? "disabled" : ""}`}><input type="file" accept=".xlsx" disabled={activityClosed || publishing} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onFile(file); }} />{isPending || displayFileName ? "重新选择文件" : "选择 Excel"}</label></div></footer>
        </article>
        <div className="attendance-overview-card"><div><span>{isPending ? "待发布名单" : "当前名单"}</span><strong>{previewRows.length}<small> 名</small></strong><em>{isPending ? `原始 ${originalCount} · 移除 ${removedCount}` : "当前导入批次"}</em></div><div><span>已关联记录／资格客户</span><b>{linkedCount}／{eligibleCustomerCount}</b></div><div><span>待确认</span><b>{pendingCount}</b></div><div><span>未关联</span><b>{unmatchedCount}</b></div>{unspecifiedCustomerType ? <div><span>客户范围</span><b>全部客户</b></div> : <div><span>综合／特渠</span><b>{comprehensiveCount}／{specialCount}</b></div>}<div><span>已填写电话</span><b>{phoneCount}</b></div>{!unspecifiedCustomerType && <div><span>未填客户类型</span><b>{blankTypeCount}</b></div>}<p>{isPending ? "当前为发布前试算；按当前已发布白名单实时计算，正式发布时会再次校验白名单版本。" : "仅已关联当前有效白名单的到场记录具备现场抽奖资格。"}</p></div>
      </div>
      {displayWarnings.length > 0 && <div className="warning-box attendance-warning"><b>导入提示</b>{displayWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
      <div className="data-section-title"><div><b>{isPending ? "待导入到场客户预览" : "到场客户名单"}</b><span>{isPending ? `${pendingImport?.fileName} · 尚未确认` : fileName ? `${fileName} · 当前导入结果` : "尚未导入到场名单"}</span></div><span className={`attendance-not-linked ${isPending ? "pending" : ""}`}>{isPending ? `白名单实时试算 · 已关联 ${linkedCount}` : `已关联 ${linkedCount} / ${previewRows.length}`}</span></div>
      <AttendanceTable rows={previewRows} onEdit={onEdit} onDelete={onDelete} allowDelete={!activityClosed} allowDeleteAll={!activityClosed} readOnly={activityClosed} customerTypeMode={customerTypeMode} />
      {isPending && <div className="attendance-publish-panel">
        <div className="attendance-publish-summary"><b>发布摘要</b><span>待发布 <strong>{previewRows.length}</strong> 名</span><span>已关联 <strong>{linkedCount}</strong> 条</span><span>资格客户 <strong>{eligibleCustomerCount}</strong> 名</span><span>待确认 <strong>{pendingCount}</strong> 条</span><span>未关联 <strong>{unmatchedCount}</strong> 条</span></div>
        <p>{blockingCount > 0 ? `存在 ${blockingCount} 条 Excel 数据异常，必须先编辑或删除。` : "按客户类型和经销商名称关联当前白名单；现场手机号仅作联系信息。待确认和未关联记录可以发布，但不会进入抽奖候选池。"}</p>
        <button type="button" className="admin-primary wide" disabled={activityClosed || previewRows.length === 0 || blockingCount > 0 || previewLoading || publishing} onClick={onConfirmImport}>{publishing ? "正在发布…" : previewLoading ? "正在计算关联结果…" : blockingCount > 0 ? `请先处理 ${blockingCount} 条异常记录` : `确认替换当前到场名单 ${previewRows.length} 名`}</button>
      </div>}
    </div>
  );
}
