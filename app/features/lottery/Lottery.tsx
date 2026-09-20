"use client";

import { useEffect, useState } from "react";
import { ApiError, completeLotteryRound, createLotteryRule, drawLotteryRound, loadLotteryStatistics, loadPublicLottery, previewLotteryCandidates, publishLotteryRule, updateLotteryRule, type LotteryCandidatePreview, type LotteryRuleApi, type LotteryWinnerApi, type LotteryWinnerStatistics } from "../../api";
import type { AttendanceCustomerType, AttendanceRow } from "../../domain/import-domain";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { normalizeSearchText } from "../shared/utils";

export type CandidateScope = "all" | "attended" | "ordered";
export type LotteryRoundStatus = "draft" | "published" | "completed";
export type LotteryRound = {
  id: number;
  ruleId?: number;
  serverStatus?: string;
  name: string;
  prize: string;
  winnerCount: number;
  customerType: "全部客户" | "特渠专业客户" | "综合客户";
  scope: CandidateScope;
  minAmount: number;
  excludeWinners: boolean;
  status: LotteryRoundStatus;
  candidateCount: number;
};
const dealerNames = [
  "上海爱尚真", "江苏徐工电子公司", "江苏四合商贸发展", "北京智享云采经贸", "北京惠通达行商贸",
  "农膳坊健康公司", "北京谷力供应链管理", "湖北中合誉品", "上海高顿", "北京金箔永和贸易",
  "河北金源粮油", "上海迦新", "青岛奥德", "河北惊钰", "石家庄德众",
  "天津益食满城", "山东有机有缘", "山东鲸桥裕", "上海赞畅", "唐山红星",
  "青岛大优供应链", "青岛超祥", "汇德丰贸易", "上海安食记", "河南百企助农",
  "湖北省诚新物流", "北京金联创科贸", "深圳曹销分", "河南满粮商贸", "益丰万立",
];

export const initialLotteryRounds: LotteryRound[] = [
  { id: -1, name: "第一轮", prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, excludeWinners: false, status: "draft", candidateCount: 0 },
];

function lotteryCustomerTypeCode(customerType: LotteryRound["customerType"]) {
  return customerType === "综合客户" ? "GENERAL" : customerType === "特渠专业客户" ? "SPECIAL" : "ALL";
}

export function mapLotteryRule(rule: LotteryRuleApi): LotteryRound[] {
  return rule.rounds.map((round) => ({ id: round.id, ruleId: rule.id, serverStatus: round.status, name: round.name,
    prize: round.prizeName, winnerCount: round.winnerCount,
    customerType: round.customerType === "GENERAL" ? "综合客户" : round.customerType === "SPECIAL" ? "特渠专业客户" : "全部客户",
    scope: round.candidateScope === "ATTENDEES" ? "attended" : round.candidateScope === "VALID_ORDERS" ? "ordered" : "all",
    minAmount: Number(round.minimumOrderAmount),
    excludeWinners: round.excludePreviousWinners, status: round.status === "COMPLETED" ? "completed" : round.status === "DRAFT" ? "draft" : "published",
    candidateCount: round.candidateCount ?? 0 }));
}

export function groupLotteryWinnersByRound(winners: LotteryWinnerApi[]) {
  const grouped: Record<number, string[]> = {};
  for (const winner of [...winners].sort((a, b) => a.roundId - b.roundId || a.position - b.position)) {
    (grouped[winner.roundId] ??= []).push(winner.dealerDisplayName);
  }
  return grouped;
}

type LotteryDisplayCandidate = {
  id: string;
  displayName: string;
  attendeeName: string;
  customerType: AttendanceCustomerType | "";
};

function attendanceCompanyKey(value: string) {
  return normalizeSearchText(value).replace(/[()（）\[\]【】{}：:，,。·\-_/\\]/g, "");
}

function getAttendanceCandidates(rows: AttendanceRow[], customerType: LotteryRound["customerType"]): LotteryDisplayCandidate[] {
  const seenCompanies = new Set<string>();
  return [...rows]
    .filter((row) => row.activityCustomerId !== null && row.matchStatus === "MATCHED" && row.lotteryEligible === true
      && row.dealerCompany.trim()
      && (customerType === "全部客户" || row.customerType === customerType))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .filter((row) => {
      const key = attendanceCompanyKey(row.dealerCompany);
      if (!key || seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    })
    .map((row) => ({ id: row.id, displayName: row.dealerCompany.trim(), attendeeName: row.dealerName.trim(), customerType: row.customerType }));
}

export function LotteryBoard({ rounds, attendanceRows, activityId, activityFinished, onComplete }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; activityId: number; activityFinished: boolean; onComplete: (id: number) => void }) {
  const [status, setStatus] = useState<"ready" | "rolling" | "done" | "finished">("ready");
  const [ticker, setTicker] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [drawnCandidateNames, setDrawnCandidateNames] = useState<string[]>([]);
  const [persistedWinners, setPersistedWinners] = useState<string[]>([]);
  const [historyWinnersByRound, setHistoryWinnersByRound] = useState<Record<number, string[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySelectionInitialized, setHistorySelectionInitialized] = useState(false);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const availableRounds = rounds.filter((item) => item.status !== "draft");
  const [roundId, setRoundId] = useState(availableRounds.find((item) => item.serverStatus !== "COMPLETED")?.id ?? availableRounds[0]?.id ?? 0);
  const currentRound = availableRounds.find((item) => item.id === roundId) ?? availableRounds[0];
  useEffect(() => {
    if (!activityFinished || historySelectionInitialized || availableRounds.length === 0) return;
    setRoundId(availableRounds[0].id);
    setHistorySelectionInitialized(true);
  }, [activityFinished, availableRounds.length, historySelectionInitialized]);
  useEffect(() => {
    if (!activityFinished) return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    void loadPublicLottery().then((data) => {
      if (!active) return;
      setHistoryWinnersByRound(groupLotteryWinnersByRound(data.winners));
    }).catch((error) => {
      if (active) setHistoryError(error instanceof ApiError ? error.message : "历史结果加载失败");
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [activityFinished]);
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const attendanceCandidates = currentRound?.scope === "attended" ? getAttendanceCandidates(attendanceRows, currentRound.customerType) : [];
  const candidateNames = currentRound?.scope === "attended" ? attendanceCandidates.map((candidate) => candidate.displayName) : dealerNames;
  const availableCandidateNames = currentRound?.excludeWinners ? candidateNames.filter((name) => !drawnCandidateNames.includes(name)) : candidateNames;
  const rollingCount = persistedWinners.length || currentRound?.winnerCount || 0;
  const rollingNames = availableCandidateNames.length > 0
    ? Array.from({ length: Math.min(rollingCount, availableCandidateNames.length) }, (_, i) => availableCandidateNames[(ticker + i * 3) % availableCandidateNames.length])
    : Array.from({ length: rollingCount }, (_, index) => `幸运客户 ${index + 1}`);
  const winners = status === "done" ? persistedWinners : rollingNames;
  const selectedHistoryWinners = currentRound ? historyWinnersByRound[currentRound.id] ?? [] : [];
  useEffect(() => {
    if (activityFinished) return;
    let active = true;
    void loadPublicLottery().then((data) => {
      if (!active) return;
      if (!currentRound) return;
      const names = data.winners.filter((winner) => winner.roundId === currentRound.id).sort((a, b) => a.position - b.position).map((winner) => winner.dealerDisplayName);
      if (names.length > 0) { setPersistedWinners(names); setStatus(currentRound.serverStatus === "COMPLETED" ? "finished" : "done"); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activityFinished, currentRound?.id, currentRound?.serverStatus]);
  if (!currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>暂无已发布抽奖轮次</h2></div></section>;
  const handleAction = async () => {
    if (sessionFinished || activityFinished) return;
    setActionError("");
    if (status === "ready") {
      setSubmitting(true);
      try {
        const result = await drawLotteryRound(activityId, currentRound.id);
        setPersistedWinners(result.winners.map((winner) => winner.dealerDisplayName));
        setStatus("rolling");
      } catch (error) { setActionError(error instanceof ApiError ? error.message : "抽奖执行失败"); }
      finally { setSubmitting(false); }
    }
    else if (status === "rolling") {
      setStatus("done");
    } else if (status === "done") {
      setSubmitting(true);
      try {
        await completeLotteryRound(activityId, currentRound.id);
        setDrawnCandidateNames((current) => [...new Set([...current, ...persistedWinners])]);
        onComplete(currentRound.id);
        const currentIndex = availableRounds.findIndex((item) => item.id === currentRound.id);
        const next = availableRounds.slice(currentIndex + 1).find((item) => item.status !== "completed");
        if (next) { setRoundId(next.id); setPersistedWinners([]); setStatus("ready"); }
        else { setStatus("finished"); setSessionFinished(true); }
      } catch (error) { setActionError(error instanceof ApiError ? error.message : "完成本轮抽奖失败"); }
      finally { setSubmitting(false); }
    }
  };
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <div className="lottery-controls">
        <label htmlFor={activityFinished ? "lottery-round-selector" : undefined}>{activityFinished ? "查看轮次" : "当前轮次"}</label>
        {activityFinished ? <select id="lottery-round-selector" aria-label="选择要查看的抽奖轮次" value={String(currentRound.id)} disabled={historyLoading || submitting} onChange={(event) => setRoundId(Number(event.target.value))}>
          {availableRounds.map((item) => <option key={item.id} value={item.id}>{item.name} · {historyWinnersByRound[item.id]?.length ? "已开奖" : item.serverStatus === "COMPLETED" ? "已完成" : "暂无结果"}</option>)}
        </select> : <><b>{currentRound.name}</b><small> · 按配置顺序执行</small></>}
      </div>
      <div className="lottery-title"><b>{currentRound.name} 幸运抽奖</b><span>{activityFinished ? "活动已结束 · 历史结果回看" : `实物奖品：${currentRound.prize}`}</span></div>
      {activityFinished ? historyLoading ? (
        <div className="lottery-ready history-empty"><h2>正在加载历史结果</h2><p>请稍候，正在读取各轮次的中奖名单</p></div>
      ) : historyError ? (
        <div className="lottery-ready history-empty"><h2>历史结果暂时无法加载</h2><p>{historyError}</p></div>
      ) : selectedHistoryWinners.length > 0 ? (
        <div className="winner-grid finished">
          {selectedHistoryWinners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      ) : (
        <div className="lottery-ready history-empty"><h2>本轮暂无中奖结果</h2><p>该轮次没有已保存的有效中奖记录</p></div>
      ) : status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2><p>候选资格将在开始抽奖时由服务端复核并固定</p></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      {actionError && <p className="field-error">{actionError}</p>}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={activityFinished || submitting || sessionFinished || (currentRound.status === "completed" && status === "ready")}>
        {activityFinished ? "活动已结束 · 仅可回看" : submitting ? "正在保存抽奖结果…" : sessionFinished || status === "finished" ? "本场抽奖已完成" : currentRound.status === "completed" && status === "ready" ? "本轮已完成" : status === "ready" ? "开始抽奖" : status === "rolling" ? "停止并揭晓" : "完成本轮抽奖"}
      </button>
    </section>
  );
}



export function LotterySettings({ rounds, attendanceRows, activityId, customerCount, customerTypeMode = "TYPED", readOnly, onChange }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; activityId: number; customerCount: number; customerTypeMode?: "TYPED" | "UNSPECIFIED"; readOnly: boolean; onChange: (rounds: LotteryRound[]) => void }) {
  const [selectedId, setSelectedId] = useState(rounds.find((item) => item.status === "published")?.id ?? rounds[0]?.id ?? -1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [preview, setPreview] = useState<LotteryCandidatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [statistics, setStatistics] = useState<LotteryWinnerStatistics>({ validWinnerRecords: 0, validWinnerCustomers: 0, invalidatedWinnerRecords: 0 });
  const selected = rounds.find((item) => item.id === selectedId) ?? rounds[0];
  const selectedIndex = Math.max(0, rounds.findIndex((item) => item.id === selected.id));
  const selectedLocked = readOnly || Boolean(selected.serverStatus && !["DRAFT", "READY"].includes(selected.serverStatus));
  const effectiveSelectedCustomerType = customerTypeMode === "UNSPECIFIED" ? "全部客户" : selected.customerType;
  const customerTypeOptions = customerTypeMode === "UNSPECIFIED" ? ["全部客户"] : ["全部客户", "特渠专业客户", "综合客户"];
  const statusLabel = { draft: "草稿", published: "已发布", completed: "已完成" } as const;
  const scopeOptions: { key: CandidateScope; title: string; detail: string }[] = [
    { key: "all", title: "所有活动客户", detail: "当前活动有效白名单" },
    { key: "attended", title: "现场到场客户", detail: "按签到或导入结果筛选" },
    { key: "ordered", title: "有效下单客户", detail: "当前已提交订单" },
  ];
  const updateSelected = (patch: Partial<LotteryRound>) => onChange(rounds.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  useEffect(() => {
    if (!Number.isFinite(activityId) || activityId <= 0 || !selected) return;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true); setSaveError("");
      void previewLotteryCandidates(activityId, {
        roundNo: selectedIndex + 1, winnerCount: selected.winnerCount,
        candidateScope: selected.scope === "attended" ? "ATTENDEES" : selected.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
        customerType: lotteryCustomerTypeCode(effectiveSelectedCustomerType),
        minimumOrderAmount: selected.scope === "ordered" ? selected.minAmount : 0,
        excludePreviousWinners: selectedIndex > 0 && selected.excludeWinners,
      }).then(setPreview).catch((error) => setSaveError(error instanceof ApiError ? error.message : "候选名单试算失败"))
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activityId, selected, selectedIndex, effectiveSelectedCustomerType]);
  useEffect(() => {
    if (!Number.isFinite(activityId) || activityId <= 0) return;
    void loadLotteryStatistics(activityId).then(setStatistics).catch(() => undefined);
  }, [activityId, rounds]);
  const addRound = () => {
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    const next: LotteryRound = { id, name: `第${rounds.length + 1}轮`, prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, excludeWinners: true, status: "draft", candidateCount: 0 };
    onChange([...rounds, next]);
    setSelectedId(id);
  };
  const duplicateRound = () => {
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    onChange([...rounds, { ...selected, id, ruleId: undefined, serverStatus: undefined, name: `${selected.name}副本`, status: "draft" }]);
    setSelectedId(id);
  };
  const saveAndPublish = async () => {
    setSaving(true); setSaveError("");
    try {
      const body = { name: "订货会幸运抽奖规则", rounds: rounds.map((round, index) => ({ name: round.name, prizeName: round.prize,
        winnerCount: round.winnerCount, candidateScope: round.scope === "attended" ? "ATTENDEES" : round.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
         customerType: lotteryCustomerTypeCode(customerTypeMode === "UNSPECIFIED" ? "全部客户" : round.customerType),
        minimumOrderAmount: round.scope === "ordered" ? round.minAmount : 0,
        excludePreviousWinners: index === 0 ? false : round.excludeWinners, displayNameType: "FULL_NAME" })) };
      const existingRuleId = rounds.find((round) => round.ruleId && ["DRAFT", "READY", "DRAWN", "COMPLETED", "RESET"].includes(round.serverStatus || ""))?.ruleId;
      const saved = existingRuleId ? await updateLotteryRule(activityId, existingRuleId, body) : await createLotteryRule(activityId, body);
      const published = saved.status === "DRAFT" ? await publishLotteryRule(activityId, saved.id) : saved;
      const mapped = mapLotteryRule(published);
      onChange(mapped); setSelectedId(mapped[0]?.id ?? -1);
    } catch (error) { setSaveError(error instanceof ApiError ? error.message : "抽奖规则保存失败"); }
    finally { setSaving(false); }
  };
  const removeRound = () => {
    if (selectedLocked || rounds.length === 1) return;
    const rest = rounds.filter((item) => item.id !== selected.id);
    onChange(rest);
    setSelectedId(rest[0].id);
  };
  const ruleSummary = `${effectiveSelectedCustomerType} · ${selected.scope === "all" ? "活动白名单" : selected.scope === "attended" ? "现场已到场" : "有效下单"}${selected.scope === "ordered" && selected.minAmount > 0 ? ` · 订单满 ¥${selected.minAmount.toLocaleString()}` : ""} · ${selectedIndex === 0 ? "第一轮不涉及历史中奖" : selected.excludeWinners ? "排除已中奖" : "允许重复中奖"}`;
  const resolvedCandidateCount = preview?.candidateCount ?? 0;
  const candidateSteps: [string, number][] = [["当前有效白名单", customerCount], [selected.scope === "attended" ? "已匹配到场客户" : selected.scope === "ordered" ? "有效订单客户" : "客户类型匹配", resolvedCandidateCount], ...(selectedIndex > 0 && selected.excludeWinners ? [["排除已中奖", resolvedCandidateCount] as [string, number]] : [])];
  return (
    <div className="admin-panel lottery-settings">
      <div className="panel-title"><div><h2>抽奖规则工作台</h2><p>{readOnly ? "整场活动已结束，抽奖规则和结果只读" : "候选按白名单客户 ID 去重并严格按轮次执行；已开始轮次自动锁定"}</p></div><div className="panel-actions"><span className="attendance-not-linked">现场名单已同步 {attendanceRows.length} 名</span><button className="admin-primary" disabled={readOnly || saving || rounds.length === 0} onClick={saveAndPublish}>{readOnly ? "活动已结束" : saving ? "正在保存…" : rounds.some((round) => round.serverStatus === "READY") ? "保存规则修改" : "保存并发布"}</button></div></div>
      {saveError && <div className="warning-box"><b>抽奖规则未发布</b><span>{saveError}</span></div>}
      <div className="lottery-overview">
        <article><span>抽奖轮次</span><strong>{rounds.length}</strong><small>{rounds.filter((x) => x.status === "completed").length} 轮已完成</small></article>
        <article><span>活动客户</span><strong>{customerCount.toLocaleString()}</strong><small>白名单有效客户</small></article>
        <article><span>现场到场</span><strong>{attendanceRows.length}</strong><small>当前到场名单</small></article>
        <article><span>已中奖客户</span><strong>{statistics.validWinnerCustomers}</strong><small>数据库当前有效 · {statistics.invalidatedWinnerRecords} 条已作废</small></article>
      </div>
      <div className="lottery-config-grid">
        <section className="round-list"><div className="section-heading"><h3>抽奖轮次</h3><span>按顺序执行</span></div>{rounds.map((item, index) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.name}</b><small>{item.prize}</small></span><em><small className={`round-status ${item.status}`}>{statusLabel[item.status]}</small>{item.winnerCount} 人</em></button>)}<button className="add-round" disabled={readOnly} onClick={addRound}>＋ 新增抽奖轮次</button></section>
        <section className="round-form">
          <div className="round-form-heading"><div><h3>{selected.name}</h3><span className={`round-status ${selected.status}`}>{statusLabel[selected.status]}</span></div><div><button onClick={duplicateRound} disabled={readOnly}>复制</button><button onClick={removeRound} disabled={selectedLocked}>删除</button></div></div>
          <label><span>轮次名称</span><input value={selected.name} disabled={selectedLocked} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
          <label><span>奖品名称</span><input value={selected.prize} disabled={selectedLocked} onChange={(e) => updateSelected({ prize: e.target.value })} /></label>
          <label><span>中奖人数</span><input type="number" min="1" value={selected.winnerCount} disabled={selectedLocked} onChange={(e) => updateSelected({ winnerCount: Number(e.target.value) })} /></label>
          <label><span>客户类型</span><select value={effectiveSelectedCustomerType} disabled={selectedLocked || customerTypeMode === "UNSPECIFIED"} onChange={(e) => updateSelected({ customerType: e.target.value as LotteryRound["customerType"] })}>{customerTypeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <fieldset className="candidate-scope"><legend>候选客户范围</legend>{scopeOptions.map((option) => <button type="button" key={option.key} className={selected.scope === option.key ? "active" : ""} disabled={selectedLocked} onClick={() => updateSelected({ scope: option.key, minAmount: option.key === "ordered" ? selected.minAmount : 0 })}><i>{selected.scope === option.key ? "✓" : ""}</i><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</fieldset>
          {selected.scope === "ordered" && <label><span>最低订单金额</span><div className="amount-input"><b>¥</b><input type="number" min="0" value={selected.minAmount} disabled={selectedLocked} onChange={(e) => updateSelected({ minAmount: Number(e.target.value) })} /></div><small className="field-help">填写 0 表示不限制订单金额；以开奖时有效订单为准</small></label>}
          <label className="check-setting repeat-setting"><input type="checkbox" checked={selectedIndex === 0 ? false : selected.excludeWinners} disabled={selectedLocked || selectedIndex === 0} onChange={(e) => updateSelected({ excludeWinners: e.target.checked })} /><span><b>排除本活动已中奖客户</b><small>{selectedIndex === 0 ? "第一轮暂无历史中奖客户，无需设置" : "按白名单客户 ID 避免跨轮次重复中奖"}</small></span></label>
          <div className="rule-summary"><span>当前规则</span><p>{ruleSummary}</p></div>
          <div className="candidate-preview"><div><span>实时候选池</span><strong>{previewLoading ? "…" : resolvedCandidateCount}<small> 人</small></strong><p>后端实时试算 · 按白名单客户 ID 去重 · {preview ? new Date(preview.calculatedAt).toLocaleString("zh-CN", { hour12: false }) : "等待试算"}</p>{preview && preview.unawardedCount > 0 && <small className="field-error">配置中奖 {preview.configuredWinnerCount} 人，当前将由全部 {preview.actualWinnerCount} 名候选中奖，空缺 {preview.unawardedCount} 个名额</small>}</div><button disabled={previewLoading || !preview} onClick={() => setPreviewOpen(true)}>查看候选名单</button></div>
        </section>
      </div>
      {previewOpen && preview && <div className="order-drawer-backdrop" onClick={() => setPreviewOpen(false)}><aside className="order-drawer candidate-drawer" onClick={(e) => e.stopPropagation()}><header><div><span>实时候选池预览</span><h2>{selected.name} · {resolvedCandidateCount} 人</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="candidate-funnel">{candidateSteps.map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div><div className="candidate-table">{preview.candidates.map((candidate, index) => <div key={candidate.activityCustomerId}><span>{String(index + 1).padStart(3, "0")}</span><b>{candidate.dealerFullName}</b><em>{candidate.customerType === "SPECIAL" ? "特渠" : candidate.customerType === "GENERAL" ? "综合" : "全部客户"}</em><small>ID {candidate.activityCustomerId} · {candidate.branchName || candidate.regionCode || "—"}{candidate.qualifyingOrderAmount != null ? ` · ¥${Number(candidate.qualifyingOrderAmount).toLocaleString()}` : ""}</small></div>)}{preview.candidates.length === 0 && <div className="table-empty">当前没有符合条件的候选客户</div>}</div><footer><small>正式候选将在点击开始抽奖时再次校验并固定</small><button className="admin-primary" onClick={() => setPreviewOpen(false)}>关闭</button></footer></aside></div>}
    </div>
  );
}
