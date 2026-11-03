"use client";

import { useAdminQuery } from "../admin/useAdminQuery";
import { useLazyAdminQuery } from "../admin/useLazyAdminQuery";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiAssetUrl, ApiError, completeLotteryRound, createLotteryRule, deleteLotteryPrizeImage, drawLotteryRound, loadLotteryRules, loadLotteryStatistics, loadLotteryProductOptions, loadPublicLottery, previewLotteryCandidates, publishLotteryRule, reorderLotteryRounds, updateLotteryRule, uploadLotteryPrizeImage, type LotteryCandidatePreview, type LotteryProductOption, type LotteryRuleApi, type LotteryRoundOrder, type LotteryWinnerApi, type LotteryWinnerStatistics } from "../../api";
import type { AttendanceCustomerType, AttendanceRow } from "../../domain/import-domain";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { Thumbnail } from "../shared/components/Thumbnail";
import { normalizeSearchText } from "../shared/utils";

export type CandidateScope = "all" | "attended" | "ordered";
export type QualificationMetric = "AMOUNT" | "BOX_COUNT" | "TONS";
export type LotteryProbabilityMode = "EQUAL" | "ORDER_AMOUNT_WEIGHTED" | "ORDER_BOX_COUNT_WEIGHTED" | "ORDER_TONS_WEIGHTED";
export type LotteryRoundStatus = "draft" | "published" | "completed";
export type LotteryRound = {
  id: number;
  ruleId?: number;
  ruleRevision?: number;
  currentAttemptNo?: number;
  roundNo?: number;
  serverStatus?: string;
  name: string;
  prize: string;
  winnerCount: number;
  customerType: "全部客户" | "特渠专业客户" | "综合客户";
  scope: CandidateScope;
  minAmount: number;
  qualificationMetric: QualificationMetric;
  probabilityMode: LotteryProbabilityMode;
  minBoxCount: number;
  minTons?: number;
  productLine?: string | null;
  productLineUnassigned?: boolean;
  varieties?: string[] | null;
  includeUnspecifiedVariety?: boolean;
  prizeImageFileId?: number;
  prizeImageUrl?: string;
  savedPrizeImageFileId?: number;
  excludeWinners: boolean;
  status: LotteryRoundStatus;
  candidateCount: number;
};
type LotteryHistoryLoadState =
  | { requestKey: string; status: "ready"; rounds: LotteryRound[]; winnersByRound: Record<number, string[]> }
  | { requestKey: string; status: "error"; message: string };
const dealerNames = [
  "上海爱尚真", "江苏徐工电子公司", "江苏四合商贸发展", "北京智享云采经贸", "北京惠通达行商贸",
  "农膳坊健康公司", "北京谷力供应链管理", "湖北中合誉品", "上海高顿", "北京金箔永和贸易",
  "河北金源粮油", "上海迦新", "青岛奥德", "河北惊钰", "石家庄德众",
  "天津益食满城", "山东有机有缘", "山东鲸桥裕", "上海赞畅", "唐山红星",
  "青岛大优供应链", "青岛超祥", "汇德丰贸易", "上海安食记", "河南百企助农",
  "湖北省诚新物流", "北京金联创科贸", "深圳曹销分", "河南满粮商贸", "益丰万立",
];

export const initialLotteryRounds: LotteryRound[] = [
  { id: -1, name: "第一轮", prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, qualificationMetric: "AMOUNT", probabilityMode: "ORDER_AMOUNT_WEIGHTED", minBoxCount: 0, excludeWinners: false, status: "draft", candidateCount: 0 },
];

function lotteryCustomerTypeCode(customerType: LotteryRound["customerType"]) {
  return customerType === "综合客户" ? "GENERAL" : customerType === "特渠专业客户" ? "SPECIAL" : "ALL";
}

const probabilityLabels: Record<LotteryProbabilityMode, string> = {
  EQUAL: "等概率", ORDER_AMOUNT_WEIGHTED: "按金额加权", ORDER_BOX_COUNT_WEIGHTED: "按箱数加权", ORDER_TONS_WEIGHTED: "按吨数加权",
};
function weightingMetric(mode: LotteryProbabilityMode): QualificationMetric | null {
  return mode === "ORDER_AMOUNT_WEIGHTED" ? "AMOUNT" : mode === "ORDER_BOX_COUNT_WEIGHTED" ? "BOX_COUNT" : mode === "ORDER_TONS_WEIGHTED" ? "TONS" : null;
}

export function mapLotteryRule(rule: LotteryRuleApi): LotteryRound[] {
  return rule.rounds.map((round) => ({ id: round.id, ruleId: rule.id, ruleRevision: rule.revision ?? 0, currentAttemptNo: round.currentAttemptNo ?? 0, roundNo: round.roundNo, serverStatus: round.status, name: round.name,
    prize: round.prizeName, winnerCount: round.winnerCount,
    customerType: round.customerType === "GENERAL" ? "综合客户" : round.customerType === "SPECIAL" ? "特渠专业客户" : "全部客户",
    scope: round.candidateScope === "ATTENDEES" ? "attended" : round.candidateScope === "VALID_ORDERS" ? "ordered" : "all",
    minAmount: Number(round.minimumOrderAmount),
    qualificationMetric: round.qualificationMetric ?? "AMOUNT",
    probabilityMode: round.probabilityMode ?? "EQUAL",
    minBoxCount: Number(round.minimumOrderBoxCount ?? 0),
    minTons: Number(round.minimumOrderTons ?? 0), productLine: round.productLine ?? null,
    productLineUnassigned: round.productLineUnassigned ?? false,
    varieties: (round.varieties?.length || round.includeUnspecifiedVariety) ? round.varieties ?? [] : null,
    includeUnspecifiedVariety: round.includeUnspecifiedVariety ?? false,
    prizeImageFileId: round.prizeImageFileId ?? undefined,
    prizeImageUrl: round.prizeImageUrl ? apiAssetUrl(round.prizeImageUrl) : undefined,
    savedPrizeImageFileId: round.prizeImageFileId ?? undefined,
    excludeWinners: round.excludePreviousWinners, status: round.status === "COMPLETED" ? "completed" : round.status === "DRAFT" ? "draft" : "published",
    candidateCount: round.candidateCount ?? 0 }));
}

export function applyLotteryOrder(rounds: LotteryRound[], order: LotteryRoundOrder): LotteryRound[] {
  const byId = new Map(rounds.map(round => [round.id, round]));
  return order.rounds.map(position => ({ ...byId.get(position.id)!, roundNo: position.roundNo,
    ruleRevision: order.revision, currentAttemptNo: position.currentAttemptNo, serverStatus: position.status,
    status: position.status === "COMPLETED" ? "completed" : position.status === "DRAFT" ? "draft" : "published" }));
}

export function lotteryLockedThrough(rounds: LotteryRound[]) {
  let locked = -1;
  rounds.forEach((round, index) => {
    if (round.status === "completed" || (round.currentAttemptNo ?? 0) > 0 || (round.serverStatus && !["DRAFT", "READY"].includes(round.serverStatus))) locked = index;
  });
  return locked;
}

export function groupLotteryWinnersByRound(winners: LotteryWinnerApi[]) {
  const grouped: Record<number, string[]> = {};
  for (const winner of [...winners].sort((a, b) => a.roundId - b.roundId || a.position - b.position)) {
    (grouped[winner.roundId] ??= []).push(winner.dealerDisplayName);
  }
  return grouped;
}

function qualifyingOrderDisplay(candidate: LotteryCandidatePreview["candidates"][number], round: LotteryRound) {
  const details: string[] = [];
  if ((round.scope === "ordered" && round.qualificationMetric === "TONS") || round.probabilityMode === "ORDER_TONS_WEIGHTED") {
    details.push(Number(candidate.qualifyingOrderTons ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " 吨");
  }
  if (((round.scope === "ordered" && round.qualificationMetric === "BOX_COUNT") || round.probabilityMode === "ORDER_BOX_COUNT_WEIGHTED") && candidate.qualifyingOrderBoxCount != null) {
    details.push(Number(candidate.qualifyingOrderBoxCount).toLocaleString() + " 箱");
  }
  if ((round.scope === "ordered" && round.qualificationMetric === "AMOUNT") || round.probabilityMode === "ORDER_AMOUNT_WEIGHTED") {
    if (candidate.qualifyingOrderAmount != null) details.push("订单 ¥" + Number(candidate.qualifyingOrderAmount).toLocaleString());
  }
  if (candidate.probabilityPercent != null) {
    details.push("抽取权重占比 " + Number(candidate.probabilityPercent ?? 0).toFixed(2) + "%");
  }
  return details.length > 0 ? " · " + details.join(" · ") : "";
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
  const [ticker, setTicker] = useState(0);
  const [animation, setAnimation] = useState<{ activityId: number; roundId: number; status: "rolling" | "done" } | null>(null);
  const [historyResult, setHistoryResult] = useState<LotteryHistoryLoadState | null>(null);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const actionLock = useRef(false);
  const [reload, setReload] = useState(0);
  const [roundSelection, setRoundSelection] = useState<{ activityId: number; roundId: number | null }>({ activityId, roundId: null });
  const selectedRoundId = roundSelection.activityId === activityId ? roundSelection.roundId : null;
  const requestKey = `${activityId}:${selectedRoundId}:${activityFinished}:${reload}`;
  const currentHistoryResult = historyResult?.requestKey === requestKey ? historyResult : null;
  const historyLoading = currentHistoryResult === null;
  const historyError = currentHistoryResult?.status === "error" ? currentHistoryResult.message : "";
  const historyWinnersByRound = currentHistoryResult?.status === "ready" ? currentHistoryResult.winnersByRound : {};
  const availableRounds = (currentHistoryResult?.status === "ready" ? currentHistoryResult.rounds : rounds).filter((item) => item.status !== "draft");
  const executionRound = availableRounds.find((item) => item.status !== "completed");
  const allCompleted = availableRounds.length > 0 && !executionRound;
  const lastResultRound = [...availableRounds].reverse().find((item) => item.status === "completed" || historyWinnersByRound[item.id]?.length);
  const defaultRound = (activityFinished ? lastResultRound : executionRound) ?? availableRounds.at(-1);
  const currentRound = availableRounds.find((item) => item.id === selectedRoundId) ?? defaultRound;
  const readOnlyRound = activityFinished || currentRound?.status === "completed";
  const futureRound = !readOnlyRound && currentRound?.id !== executionRound?.id;
  const persistedWinners = currentRound ? historyWinnersByRound[currentRound.id] ?? [] : [];
  const status = readOnlyRound ? "finished" : animation?.activityId === activityId && animation.roundId === currentRound?.id
    ? animation.status : currentRound?.serverStatus === "DRAWN" || persistedWinners.length > 0 ? "done" : "ready";
  const selectRound = (roundId: number) => {
    if (actionLock.current || status === "rolling") return;
    setRoundSelection({ activityId, roundId });
    setAnimation(null);
    setActionError("");
  };
  useEffect(() => {
    let active = true;
    void loadPublicLottery().then((data) => {
      if (!active) return;
      const rule = data.rules.find((item) => item.status === "PUBLISHED") ?? data.rules[0];
      setHistoryResult({ requestKey, status: "ready", rounds: rule ? mapLotteryRule(rule) : [], winnersByRound: groupLotteryWinnersByRound(data.winners) });
    }).catch((error) => {
      if (active) setHistoryResult({ requestKey, status: "error", message: error instanceof ApiError ? error.message : "抽奖结果加载失败，请重试" });
    });
    return () => { active = false; };
  }, [requestKey]);
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const attendanceCandidates = currentRound?.scope === "attended" ? getAttendanceCandidates(attendanceRows, currentRound.customerType) : [];
  const candidateNames = currentRound?.scope === "attended" ? attendanceCandidates.map((candidate) => candidate.displayName) : dealerNames;
  const drawnCandidateNames = Object.entries(historyWinnersByRound).filter(([id]) => Number(id) !== currentRound?.id).flatMap(([, names]) => names);
  const availableCandidateNames = currentRound?.excludeWinners ? candidateNames.filter((name) => !drawnCandidateNames.includes(name)) : candidateNames;
  const rollingCount = persistedWinners.length || currentRound?.winnerCount || 0;
  const rollingNames = availableCandidateNames.length > 0
    ? Array.from({ length: Math.min(rollingCount, availableCandidateNames.length) }, (_, i) => availableCandidateNames[(ticker + i * 3) % availableCandidateNames.length])
    : Array.from({ length: rollingCount }, (_, index) => `幸运客户 ${index + 1}`);
  const winners = status === "done" || status === "finished" ? persistedWinners : rollingNames;
  // Use the drawn count while rolling so revealing the names keeps the same layout.
  const displayCount = status === "rolling" ? rollingCount : winners.length;
  const winnerDensity = displayCount === 1 ? "single" : displayCount === 2 ? "pair"
    : displayCount <= 4 ? "few" : displayCount <= 9 ? "medium" : "many";
  const retry = () => { setAnimation(null); setReload((value) => value + 1); };
  if (historyLoading && !currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>正在加载抽奖轮次</h2></div></section>;
  if (historyError && !currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>{historyError}</h2><button onClick={retry}>重新加载</button></div></section>;
  if (!currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>暂无已发布抽奖轮次</h2></div></section>;
  const handleAction = async () => {
    if (actionLock.current || readOnlyRound || futureRound || historyLoading || historyError) return;
    setActionError("");
    if (status === "ready") {
      actionLock.current = true;
      setSubmitting(true);
      try {
        const result = await drawLotteryRound(activityId, currentRound.id, currentRound.ruleRevision ?? 0);
        setHistoryResult((previous) => previous?.requestKey === requestKey && previous.status === "ready" ? {
          ...previous,
          rounds: previous.rounds.map((item) => ({ ...item, ruleRevision: result.ruleRevision ?? (currentRound.ruleRevision ?? 0) + 1,
            ...(item.id === currentRound.id ? { serverStatus: "DRAWN" } : {}) })),
          winnersByRound: { ...previous.winnersByRound, [currentRound.id]: result.winners.map((winner) => winner.dealerDisplayName) },
        } : previous);
        setAnimation({ activityId, roundId: currentRound.id, status: "rolling" });
      } catch (error) {
        setActionError(error instanceof ApiError ? error.message : "抽奖执行失败");
        if (error instanceof ApiError && error.code === "LOTTERY_RULE_CHANGED") setRoundSelection({ activityId, roundId: null });
        retry();
      }
      finally { actionLock.current = false; setSubmitting(false); }
    }
    else if (status === "rolling") {
      setAnimation({ activityId, roundId: currentRound.id, status: "done" });
    } else if (status === "done") {
      actionLock.current = true;
      setSubmitting(true);
      try {
        await completeLotteryRound(activityId, currentRound.id);
        onComplete(currentRound.id);
        setHistoryResult((previous) => previous?.requestKey === requestKey && previous.status === "ready" ? {
          ...previous, rounds: previous.rounds.map((item) => item.id === currentRound.id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item),
        } : previous);
        setRoundSelection({ activityId, roundId: null });
        // One on-demand reload also picks up configuration changes made while this round was displayed.
        retry();
      } catch (error) { setActionError(error instanceof ApiError ? error.message : "完成本轮抽奖失败"); retry(); }
      finally { actionLock.current = false; setSubmitting(false); }
    }
  };
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <div className="lottery-controls">
        <label htmlFor="lottery-round-selector">查看轮次</label>
        <select id="lottery-round-selector" aria-label="选择要查看的抽奖轮次" value={String(currentRound.id)} disabled={submitting || status === "rolling"} onChange={(event) => selectRound(Number(event.target.value))}>
          {availableRounds.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status === "completed" ? "已完成" : item.serverStatus === "DRAWN" ? "已开奖" : !activityFinished && item.id === executionRound?.id ? "当前轮次" : "未开奖"}</option>)}
        </select>
      </div>
      <div className="lottery-title">
        <b>{currentRound.name} 幸运抽奖</b>
        <span>本轮奖品：{currentRound.prize}</span>
        {currentRound.prizeImageUrl && <div className="lottery-prize-display">
          <div className="lottery-prize-image"><Thumbnail src={currentRound.prizeImageUrl} variant="display" alt={currentRound.prize} /></div>
        </div>}
      </div>
      {historyLoading ? (
        <div className="lottery-ready history-empty"><h2>正在加载历史结果</h2><p>请稍候，正在读取各轮次的中奖名单</p></div>
      ) : historyError ? (
        <div className="lottery-ready history-empty"><h2>抽奖结果暂时无法加载</h2><p>{historyError}</p><button onClick={retry}>重新加载</button></div>
      ) : readOnlyRound ? persistedWinners.length > 0 ? (
        <div className="winner-grid finished" data-density={winnerDensity}>
          {persistedWinners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b title={name}>{name}</b></div>)}
        </div>
      ) : (
        <div className="lottery-ready history-empty"><h2>{currentRound.status === "completed" || currentRound.serverStatus === "DRAWN" ? "本轮暂无中奖结果" : "本轮未开奖"}</h2><p>该轮次没有已保存的有效中奖记录</p></div>
      ) : futureRound ? (
        <div className="lottery-ready history-empty"><h2>本轮未开奖</h2><p>请先完成前面的轮次</p></div>
      ) : status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2></div>
      ) : status === "finished" && winners.length === 0 ? (
        <div className="lottery-ready history-empty"><h2>暂无已保存的中奖名单</h2><p>请刷新页面重新读取本轮抽奖结果</p></div>
      ) : (
        <div className={`winner-grid ${status}`} data-density={winnerDensity}>
          {winners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b title={name}>{name}</b></div>)}
        </div>
      )}
      {actionError && <p className="field-error">{actionError}</p>}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={readOnlyRound || futureRound || submitting || historyLoading || Boolean(historyError)}>
        {activityFinished ? "活动已结束 · 仅可回看" : submitting ? "正在保存抽奖结果…" : historyLoading ? "正在加载抽奖结果…" : historyError ? "请重新加载结果" : allCompleted ? "全部轮次已完成 · 可切换查看" : readOnlyRound ? "本轮已完成 · 仅回看" : futureRound ? "请先完成前面的轮次" : status === "ready" ? "开始抽奖" : status === "rolling" ? "停止并揭晓" : "完成本轮抽奖"}
      </button>
    </section>
  );
}



export function LotterySettings({ active = true, revision = "", rounds, attendanceRows, attendeeCount = attendanceRows.length, activityId, customerCount, customerTypeMode = "TYPED", readOnly, hasUnsavedChanges = false, onChange, onSaved, onOrderSaved }: { active?: boolean; revision?: string; onSaved?: () => void; onOrderSaved?: (rounds: LotteryRound[]) => void; hasUnsavedChanges?: boolean; rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; activityId: number; customerCount: number; attendeeCount?: number; customerTypeMode?: "TYPED" | "UNSPECIFIED"; readOnly: boolean; onChange: (rounds: LotteryRound[]) => void }) {
  const [selectedId, setSelectedId] = useState(rounds.find((item) => item.status === "published")?.id ?? rounds[0]?.id ?? -1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [edited, setEdited] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderNotice, setOrderNotice] = useState("");
  const [orderNeedsReload, setOrderNeedsReload] = useState(false);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const orderLock = useRef(false);
  const scope = useRef({ activityId, alive: true });
  useEffect(() => {
    const current = scope.current;
    current.activityId = activityId; current.alive = true;
    return () => { current.alive = false; };
  }, [activityId]);
  const [prizeImageUploading, setPrizeImageUploading] = useState(false);
  const [prizeImageError, setPrizeImageError] = useState("");
  const selected = rounds.find((item) => item.id === selectedId) ?? rounds[0];
  const selectedIndex = Math.max(0, rounds.findIndex((item) => item.id === selected.id));
  const selectedLocked = readOnly || saving || orderSaving || orderNeedsReload || prizeImageUploading || (selected.currentAttemptNo ?? 0) > 0 || Boolean(selected.serverStatus && !["DRAFT", "READY"].includes(selected.serverStatus));
  const lockedThrough = lotteryLockedThrough(rounds);
  const localOnly = rounds.every(round => round.id < 0 && !round.ruleId);
  const orderDisabled = !active || readOnly || saving || orderSaving || orderNeedsReload || prizeImageUploading
    || (!localOnly && (edited || hasUnsavedChanges || rounds.some(round => round.id < 0 || !round.ruleId)));
  const effectiveSelectedCustomerType = customerTypeMode === "UNSPECIFIED" ? "全部客户" : selected.customerType;
  const customerTypeOptions = customerTypeMode === "UNSPECIFIED" ? ["全部客户"] : ["全部客户", "特渠专业客户", "综合客户"];
  const statusLabel = { draft: "草稿", published: "已发布", completed: "已完成" } as const;
  const scopeOptions: { key: CandidateScope; title: string; detail: string }[] = [
    { key: "all", title: "所有活动客户", detail: "当前活动有效白名单" },
    { key: "attended", title: "现场到场客户", detail: "按签到或导入结果筛选" },
    { key: "ordered", title: "有效下单客户", detail: "当前已提交订单" },
  ];
  const invalidatePreview = () => { setPreviewOpen(false); setPreviewRevision(value => value + 1); };
  const selectSettingsRound = (id: number) => { if (id !== selected.id) invalidatePreview(); setSelectedId(id); };
  const updateSelected = (patch: Partial<LotteryRound>) => {
    setEdited(true);
    if (Object.keys(patch).some(key => !["name", "prize", "prizeImageFileId", "prizeImageUrl"].includes(key))) invalidatePreview();
    onChange(rounds.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  };
  const removeTemporaryPrizeImage = (fileId: number) => {
    const usedByAnotherRound = rounds.some((item) => item.id !== selected.id && item.prizeImageFileId === fileId);
    if (!usedByAnotherRound && fileId !== selected.savedPrizeImageFileId) {
      void deleteLotteryPrizeImage(activityId, fileId).catch(() => undefined);
    }
  };
  const handlePrizeImageUpload = async (file: File) => {
    const previousTemporaryFileId = selected.prizeImageFileId !== selected.savedPrizeImageFileId
      ? selected.prizeImageFileId : undefined;
    setPrizeImageUploading(true); setPrizeImageError("");
    try {
      const uploaded = await uploadLotteryPrizeImage(activityId, file);
      updateSelected({ prizeImageFileId: uploaded.fileId, prizeImageUrl: apiAssetUrl(uploaded.url) });
      if (previousTemporaryFileId && previousTemporaryFileId !== uploaded.fileId) {
        removeTemporaryPrizeImage(previousTemporaryFileId);
      }
    } catch (error) {
      setPrizeImageError(error instanceof ApiError
        ? error.status === 404 ? "图片上传接口不可用，请重新加载页面并确认后端已更新" : error.message
        : "奖品图片上传失败");
    } finally {
      setPrizeImageUploading(false);
    }
  };
  const clearPrizeImage = () => {
    if (selected.prizeImageFileId && selected.prizeImageFileId !== selected.savedPrizeImageFileId) {
      removeTemporaryPrizeImage(selected.prizeImageFileId);
    }
    updateSelected({ prizeImageFileId: undefined, prizeImageUrl: undefined });
    setPrizeImageError("");
  };
  const previewInput = {
    roundNo: selectedIndex + 1, winnerCount: selected.winnerCount,
    candidateScope: selected.scope === "attended" ? "ATTENDEES" : selected.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
    customerType: lotteryCustomerTypeCode(effectiveSelectedCustomerType),
    minimumOrderAmount: selected.scope === "ordered" ? selected.minAmount : 0,
    qualificationMetric: selected.qualificationMetric, probabilityMode: selected.probabilityMode,
    minimumOrderBoxCount: selected.scope === "ordered" ? selected.minBoxCount : 0,
    minimumOrderTons: selected.scope === "ordered" ? selected.minTons ?? 0 : 0,
    productLine: selected.scope === "ordered" ? selected.productLine ?? null : null,
    productLineUnassigned: selected.scope === "ordered" && Boolean(selected.productLineUnassigned),
    varieties: selected.scope === "ordered" ? selected.varieties ?? [] : [],
    includeUnspecifiedVariety: selected.scope === "ordered" && Boolean(selected.includeUnspecifiedVariety),
    excludePreviousWinners: selectedIndex > 0 && selected.excludeWinners,
  };
  const inputKey = JSON.stringify(previewInput);
  const candidateKey = JSON.stringify([activityId,selected.id,inputKey,revision,previewRevision]);
  const loadCandidates = useCallback((_key: string, signal: AbortSignal) =>
    previewLotteryCandidates(activityId,JSON.parse(inputKey),signal),[activityId,inputKey]);
  const candidateQuery = useAdminQuery<LotteryCandidatePreview>(active ? candidateKey : null,loadCandidates);
  const statisticsQuery = useLazyAdminQuery<LotteryWinnerStatistics>(JSON.stringify([activityId,revision]),active,
    signal => loadLotteryStatistics(activityId,signal));
  const optionsQuery = useLazyAdminQuery<LotteryProductOption[]>(JSON.stringify([activityId,revision]),active && selected.scope === "ordered",
    signal => loadLotteryProductOptions(activityId,signal));
  const optionValue = (value: string | null) => value === null ? "empty" : "value:" + value;
  const productValue = selected.productLineUnassigned ? "empty" : selected.productLine ? optionValue(selected.productLine) : "all";
  const selectedVarieties = selected.varieties == null ? null : [
    ...selected.varieties.map(value => optionValue(value)), ...(selected.includeUnspecifiedVariety ? ["empty"] : [])];
  const lineOptions = new Map((optionsQuery.data ?? []).map(option => [optionValue(option.productLine),option.productLine ?? "未填写"]));
  if (productValue !== "all" && !lineOptions.has(productValue)) lineOptions.set(productValue,selected.productLine ?? "未填写");
  const varietyOptions = new Map((optionsQuery.data ?? []).filter(option => optionValue(option.productLine) === productValue)
    .map(option => [optionValue(option.varietyName),option.varietyName ?? "未填写"]));
  for (const value of selectedVarieties ?? []) if (!varietyOptions.has(value)) varietyOptions.set(value,value === "empty" ? "未填写" : value.slice(6));
  const changeVarieties = (values: string[] | null) => updateSelected({
    varieties: values === null ? null : values.filter(value => value !== "empty").map(value => value.slice(6)),
    includeUnspecifiedVariety: values?.includes("empty") ?? false,
  });
  const validVarieties = productValue === "all" || selectedVarieties === null || selectedVarieties.length > 0;
  const preview = candidateQuery.data ?? null;
  const previewLoading = candidateQuery.loading;
  const statistics = statisticsQuery.data;
  const addRound = () => {
    if (prizeImageUploading || orderLock.current || orderNeedsReload) return;
    setEdited(true);
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    const next: LotteryRound = { id, name: `第${rounds.length + 1}轮`, prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, qualificationMetric: "AMOUNT", probabilityMode: "ORDER_AMOUNT_WEIGHTED", minBoxCount: 0, excludeWinners: true, status: "draft", candidateCount: 0 };
    onChange([...rounds, next]);
    invalidatePreview(); setSelectedId(id);
  };
  const duplicateRound = () => {
    if (prizeImageUploading || orderLock.current || orderNeedsReload) return;
    setEdited(true);
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    const metric = weightingMetric(selected.probabilityMode);
    onChange([...rounds, { ...selected, ...(metric ? { qualificationMetric: metric } : {}), id, ruleId: undefined, ruleRevision: undefined, currentAttemptNo: 0, serverStatus: undefined, name: `${selected.name}副本`, status: "draft" }]);
    invalidatePreview(); setSelectedId(id);
  };
  const saveAndPublish = async () => {
    if (saving || orderLock.current || orderNeedsReload) return;
    const targetActivity = activityId;
    orderLock.current = true;
    setSaving(true); setSaveError("");
    try {
      const body = { name: "订货会幸运抽奖规则", expectedRevision: rounds.find(round => round.ruleId)?.ruleRevision,
        roundIds: rounds.map(round => round.id > 0 && round.ruleId ? round.id : null), rounds: rounds.map((round) => ({ name: round.name, prizeName: round.prize,
        winnerCount: round.winnerCount, candidateScope: round.scope === "attended" ? "ATTENDEES" : round.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
         customerType: lotteryCustomerTypeCode(customerTypeMode === "UNSPECIFIED" ? "全部客户" : round.customerType),
         minimumOrderAmount: round.scope === "ordered" ? round.minAmount : 0,
         qualificationMetric: round.qualificationMetric,
         probabilityMode: round.probabilityMode,
         minimumOrderBoxCount: round.scope === "ordered" ? round.minBoxCount : 0,
         minimumOrderTons: round.scope === "ordered" ? round.minTons ?? 0 : 0,
         productLine: round.scope === "ordered" ? round.productLine ?? null : null,
         productLineUnassigned: round.scope === "ordered" && Boolean(round.productLineUnassigned),
         varieties: round.scope === "ordered" ? round.varieties ?? [] : [],
         includeUnspecifiedVariety: round.scope === "ordered" && Boolean(round.includeUnspecifiedVariety),
        prizeImageFileId: round.prizeImageFileId ?? null,
        excludePreviousWinners: round.excludeWinners, displayNameType: "FULL_NAME" })) };
      const existingRuleId = rounds.find((round) => round.ruleId && ["DRAFT", "READY", "DRAWN", "COMPLETED", "RESET"].includes(round.serverStatus || ""))?.ruleId;
      const saved = existingRuleId ? await updateLotteryRule(activityId, existingRuleId, body) : await createLotteryRule(activityId, body);
      const published = saved.status === "DRAFT" ? await publishLotteryRule(activityId, saved.id) : saved;
      if (!scope.current.alive || scope.current.activityId !== targetActivity) return;
      const mapped = mapLotteryRule(published);
      invalidatePreview(); onChange(mapped); onSaved?.(); setEdited(false); setSelectedId(mapped.find(round => round.id === selected.id)?.id ?? mapped[selectedIndex]?.id ?? mapped[0]?.id ?? -1);
    } catch (error) {
      if (!scope.current.alive || scope.current.activityId !== targetActivity) return;
      setSaveError(error instanceof ApiError ? error.message : "抽奖规则保存失败");
      if (error instanceof ApiError && error.code === "LOTTERY_RULE_CHANGED") setOrderNeedsReload(true);
    }
    finally { if (scope.current.alive && scope.current.activityId === targetActivity) { orderLock.current = false; setSaving(false); } }
  };
  const removeRound = () => {
    if (selectedLocked || rounds.length === 1) return;
    setEdited(true);
    if (selected.prizeImageFileId && selected.prizeImageFileId !== selected.savedPrizeImageFileId
        && !rounds.some((item) => item.id !== selected.id && item.prizeImageFileId === selected.prizeImageFileId)) {
      void deleteLotteryPrizeImage(activityId, selected.prizeImageFileId).catch(() => undefined);
    }
    const rest = rounds.filter((item) => item.id !== selected.id);
    invalidatePreview(); onChange(rest);
    setSelectedId(rest[0].id);
  };
  const commitOrder = (next: LotteryRound[]) => {
    if (onOrderSaved) onOrderSaved(next); else onChange(next);
    setEdited(false);
  };
  const reloadOrderRules = async () => {
    const targetActivity = activityId;
    const rules = await loadLotteryRules(targetActivity);
    if (!scope.current.alive || scope.current.activityId !== targetActivity) return;
    const rule = rules.find(item => item.status === "PUBLISHED") ?? rules.find(item => item.id === selected.ruleId);
    if (!rule) throw new Error("抽奖规则不存在，请重新进入页面");
    commitOrder(mapLotteryRule(rule)); invalidatePreview(); setOrderNeedsReload(false); setSaveError("");
  };
  const moveRound = async (id: number, target: number) => {
    const from = rounds.findIndex(round => round.id === id);
    if (orderLock.current || orderDisabled || from <= lockedThrough || target <= lockedThrough || target < 0 || target >= rounds.length || from === target) return;
    const next = [...rounds]; next.splice(target, 0, next.splice(from, 1)[0]);
    invalidatePreview(); setOrderNotice(""); setSaveError("");
    if (localOnly) { onChange(next); setEdited(true); setOrderNotice("顺序已调整，保存并发布后生效"); return; }
    const original = rounds, targetActivity = activityId;
    orderLock.current = true; setOrderSaving(true); onChange(next);
    try {
      const saved = await reorderLotteryRounds(activityId, selected.ruleId!, selected.ruleRevision ?? 0, next.map(round => round.id));
      if (!scope.current.alive || scope.current.activityId !== targetActivity) return;
      commitOrder(applyLotteryOrder(original, saved)); setOrderNotice("抽奖顺序已更新");
    } catch (error) {
      if (!scope.current.alive || scope.current.activityId !== targetActivity) return;
      commitOrder(original);
      if (!(error instanceof ApiError) || error.status >= 500 || error.code === "LOTTERY_RULE_CHANGED") {
        try {
          await reloadOrderRules();
          if (scope.current.alive && scope.current.activityId === targetActivity) setOrderNotice(error instanceof ApiError ? "轮次已更新，请按最新顺序重新调整" : "已核对服务器保存结果，请查看当前顺序");
        } catch {
          if (scope.current.alive && scope.current.activityId === targetActivity) { setOrderNeedsReload(true); setSaveError("暂时无法确认最新顺序，请重新加载规则后操作"); }
        }
      } else setSaveError(error.message);
    } finally {
      if (scope.current.alive && scope.current.activityId === targetActivity) { orderLock.current = false; setOrderSaving(false); }
    }
  };
  const thresholdSummary = selected.scope !== "ordered" ? "" : selected.qualificationMetric === "TONS"
    ? (selected.minTons ?? 0) > 0 ? " · 订货满 " + selected.minTons!.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " 吨" : ""
    : selected.qualificationMetric === "BOX_COUNT"
    ? selected.minBoxCount > 0 ? " · 订货满 " + selected.minBoxCount.toLocaleString() + " 箱" : ""
    : selected.minAmount > 0 ? " · 订单满 ¥" + selected.minAmount.toLocaleString() : "";
  const ruleSummary = effectiveSelectedCustomerType + " · "
    + (selected.scope === "all" ? "活动白名单" : selected.scope === "attended" ? "现场已到场" : "有效下单")
    + (selected.scope === "ordered" ? " · 项目组：" + (selected.productLineUnassigned ? "未填写" : selected.productLine || "全部")
      + " · 品种：" + (selectedVarieties === null ? "全部" : selectedVarieties.map(v => v === "empty" ? "未填写" : v.slice(6)).join("、")) : "")
    + thresholdSummary + " · "
    + probabilityLabels[selected.probabilityMode] + " · "
    + (selectedIndex === 0 ? "第一轮不涉及历史中奖" : selected.excludeWinners ? "排除已中奖" : "允许重复中奖");
  const completedCount = ["DRAWN","COMPLETED"].includes(selected.serverStatus ?? "") ? selected.candidateCount : undefined;
  const resolvedCandidateCount = preview?.candidateCount ?? completedCount;
  const candidateSteps: [string, number][] = [["当前有效白名单", customerCount], [selected.scope === "attended" ? "已匹配到场客户" : selected.scope === "ordered" ? "有效订单客户" : "客户类型匹配", resolvedCandidateCount ?? 0], ...(selectedIndex > 0 && selected.excludeWinners ? [["排除已中奖", resolvedCandidateCount ?? 0] as [string, number]] : [])];
  return (
    <div className="admin-panel lottery-settings">
      <div className="panel-title"><div><h2>抽奖规则工作台</h2><p>{readOnly ? "整场活动已结束，抽奖规则和结果只读" : "候选按白名单客户 ID 去重并严格按轮次执行；已开始轮次自动锁定"}</p></div><div className="panel-actions"><span className="attendance-not-linked">现场名单已同步 {attendeeCount} 名</span><button className="admin-primary" disabled={readOnly || saving || orderSaving || orderNeedsReload || prizeImageUploading || rounds.length === 0 || rounds.some(r => r.scope === "ordered" && r.varieties != null && r.varieties.length === 0 && !r.includeUnspecifiedVariety)} onClick={saveAndPublish}>{readOnly ? "活动已结束" : saving ? "正在保存…" : rounds.some((round) => round.serverStatus === "READY") ? "保存规则修改" : "保存并发布"}</button></div></div>
      {(saveError || candidateQuery.error || statisticsQuery.error || optionsQuery.error) && <div className="warning-box"><b>抽奖资料读取或保存失败</b><span>{saveError || candidateQuery.error || statisticsQuery.error || optionsQuery.error}</span></div>}
      {orderNotice && <p className="lottery-order-notice" role="status">{orderNotice}</p>}
      {orderNeedsReload && <button type="button" className="secondary-button" disabled={orderSaving} onClick={() => {
        if (orderLock.current) return;
        orderLock.current = true; setOrderSaving(true);
        void reloadOrderRules().then(() => { if (scope.current.alive && scope.current.activityId === activityId) setOrderNotice("已重新加载抽奖规则"); })
          .catch(() => { if (scope.current.alive && scope.current.activityId === activityId) setSaveError("规则加载失败，请重试"); })
          .finally(() => { if (scope.current.alive && scope.current.activityId === activityId) { orderLock.current = false; setOrderSaving(false); } });
      }}>重新加载规则（放弃未保存修改）</button>}
      <div className="lottery-overview">
        <article><span>抽奖轮次</span><strong>{rounds.length}</strong><small>{rounds.filter((x) => x.status === "completed").length} 轮已完成</small></article>
        <article><span>活动客户</span><strong>{customerCount.toLocaleString()}</strong><small>白名单有效客户</small></article>
        <article><span>现场到场</span><strong>{attendeeCount}</strong><small>当前到场名单</small></article>
        <article><span>已中奖客户</span><strong>{statistics?.validWinnerCustomers ?? "—"}</strong><small>{statistics ? `数据库当前有效 · ${statistics.invalidatedWinnerRecords} 条已作废` : statisticsQuery.error ? "暂未加载" : "正在加载…"}</small>{statisticsQuery.error && <button type="button" disabled={statisticsQuery.loading} onClick={() => void statisticsQuery.refresh()}>重试</button>}</article>
      </div>
      <div className="lottery-config-grid">
        <section className="round-list"><div className="section-heading"><h3>抽奖轮次</h3><span>{orderSaving ? "正在保存顺序…" : "按顺序执行"}</span></div>
          <p className="round-order-help">{readOnly ? "活动已结束，轮次只读" : !localOnly && (edited || hasUnsavedChanges || rounds.some(round => round.id < 0)) ? "请先保存规则，再调整顺序" : "拖动 ⋮⋮ 调整未开始轮次；已开始轮次位置固定"}</p>
          {rounds.map((item, index) => <div key={item.id} className={`round-row${dragTarget === index ? " drop-target" : ""}`} data-round-id={item.id}
            onDragOver={event => { if (dragging.current !== null && !orderDisabled && index > lockedThrough) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dragTarget !== index) setDragTarget(index); } }}
            onDrop={event => { event.preventDefault(); const id = dragging.current; dragging.current = null; setDragTarget(null); if (id !== null) void moveRound(id, index); }}>
            <button type="button" className="round-drag-handle" aria-label={index <= lockedThrough ? `${item.name}位置已锁定` : `拖动调整${item.name}顺序`} title={index <= lockedThrough ? "已开始轮次位置固定" : "拖动排序，也可按上下方向键移动"}
              disabled={orderDisabled || index <= lockedThrough} draggable={!orderDisabled && index > lockedThrough}
              onDragStart={event => { if (orderDisabled || index <= lockedThrough) { event.preventDefault(); return; } dragging.current = item.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(item.id)); }}
              onDragEnd={() => { dragging.current = null; setDragTarget(null); }}
              onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); void moveRound(item.id, index + (event.key === "ArrowUp" ? -1 : 1)); } }}>
              {index <= lockedThrough ? <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg> : "⋮⋮"}</button>
            <button type="button" className={selected.id === item.id ? "round-select active" : "round-select"} onClick={() => selectSettingsRound(item.id)}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.name}</b><small>{item.prize}</small></span><em><small className={`round-status ${item.status}`}>{statusLabel[item.status]}</small>{item.winnerCount} 人</em></button>
            <span className="round-move-actions"><button type="button" aria-label={`上移${item.name}`} disabled={orderDisabled || index <= lockedThrough + 1} onClick={() => void moveRound(item.id, index - 1)}>↑</button><button type="button" aria-label={`下移${item.name}`} disabled={orderDisabled || index <= lockedThrough || index === rounds.length - 1} onClick={() => void moveRound(item.id, index + 1)}>↓</button></span>
          </div>)}<button className="add-round" disabled={readOnly || saving || orderSaving || orderNeedsReload} onClick={addRound}>＋ 新增抽奖轮次</button></section>
        <section className="round-form">
          <div className="round-form-heading"><div><h3>{selected.name}</h3><span className={`round-status ${selected.status}`}>{statusLabel[selected.status]}</span></div><div><button onClick={duplicateRound} disabled={readOnly || saving || orderSaving || orderNeedsReload}>复制</button><button onClick={removeRound} disabled={selectedLocked}>删除</button></div></div>
          <label><span>轮次名称</span><input value={selected.name} disabled={selectedLocked} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
          <label><span>奖品名称</span><input value={selected.prize} disabled={selectedLocked} onChange={(e) => updateSelected({ prize: e.target.value })} /></label>
          <div className="lottery-prize-image-setting">
            <span className="lottery-prize-image-label">奖品图片</span>
            <div className={selected.prizeImageUrl ? "lottery-prize-image-preview has-image" : "lottery-prize-image-preview empty"}>
              {selected.prizeImageUrl ? <Thumbnail src={selected.prizeImageUrl} alt={selected.prize} /> : <span>暂未上传图片</span>}
            </div>
            <div className="lottery-prize-image-actions">
              <label className={selectedLocked ? "lottery-prize-image-upload disabled" : "lottery-prize-image-upload"}>
                <span>{prizeImageUploading ? "正在上传…" : selected.prizeImageUrl ? "替换图片" : "上传图片"}</span>
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" disabled={selectedLocked} onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void handlePrizeImageUpload(file);
                }} />
              </label>
              {selected.prizeImageFileId != null && <button type="button" className="lottery-prize-image-remove" disabled={selectedLocked} onClick={clearPrizeImage}>移除图片</button>}
              <small>支持 JPG、PNG、WEBP、GIF、BMP，单张不超过 10MB</small>
              {prizeImageError && <small className="field-error">{prizeImageError}</small>}
            </div>
          </div>
          <label><span>中奖人数</span><input type="number" min="1" value={selected.winnerCount} disabled={selectedLocked} onChange={(e) => updateSelected({ winnerCount: Number(e.target.value) })} /></label>
          <label><span>客户类型</span><select value={effectiveSelectedCustomerType} disabled={selectedLocked || customerTypeMode === "UNSPECIFIED"} onChange={(e) => updateSelected({ customerType: e.target.value as LotteryRound["customerType"] })}>{customerTypeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <fieldset className="candidate-scope"><legend>候选客户范围</legend>{scopeOptions.map((option) => <button type="button" key={option.key} className={selected.scope === option.key ? "active" : ""} disabled={selectedLocked} onClick={() => updateSelected({ scope: option.key })}><i>{selected.scope === option.key ? "✓" : ""}</i><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</fieldset>
          <label><span>抽取方式</span><select aria-label="抽取方式" value={selected.probabilityMode} disabled={selectedLocked} onChange={e => {
            const probabilityMode = e.target.value as LotteryProbabilityMode;
            const metric = weightingMetric(probabilityMode);
            updateSelected({ probabilityMode, ...(metric ? { qualificationMetric: metric } : {}) });
          }}>{Object.entries(probabilityLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><small className="field-help">{selected.probabilityMode === "EQUAL" ? "候选范围内所有客户等概率" : "按开奖时所选指标的实际小计加权；该指标为0的客户不进入加权池"}</small></label>
          {selected.scope === "ordered" && <>
            <label><span>门槛依据</span><select aria-label="门槛依据" value={selected.qualificationMetric} disabled={selectedLocked || selected.probabilityMode !== "EQUAL"} onChange={(e) => updateSelected({ qualificationMetric: e.target.value as QualificationMetric })}><option value="AMOUNT">最低订单金额</option><option value="BOX_COUNT">最低订货箱数</option><option value="TONS">最低订货吨数</option></select>{selected.probabilityMode !== "EQUAL" && <small className="field-help">{weightingMetric(selected.probabilityMode) === selected.qualificationMetric ? "随加权方式自动切换" : "保留原规则的门槛；重新选择加权方式后自动联动"}</small>}</label>
            {selected.qualificationMetric === "AMOUNT"
              ? <label><span>最低订单金额</span><div className="amount-input"><b>¥</b><input type="number" min="0" value={selected.minAmount} disabled={selectedLocked} onChange={(e) => updateSelected({ minAmount: Number(e.target.value) })} /></div><small className="field-help">填写 0 表示不限制订单金额；以开奖时有效订单为准</small></label>
              : selected.qualificationMetric === "TONS"
                ? <label><span>最低订货吨数</span><input aria-label="最低订货吨数" type="number" min="0" step="0.000001" value={selected.minTons ?? 0} disabled={selectedLocked} onChange={e => updateSelected({ minTons: Number(e.target.value) })} /><small className="field-help">填写0表示不限制吨数；按匹配商品可计算的吨数合计</small></label>
              : <label><span>最低订货箱数</span><input type="number" min="0" step="1" value={selected.minBoxCount} disabled={selectedLocked} onChange={(e) => updateSelected({ minBoxCount: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /><small className="field-help">填写 0 表示不限制订货箱数；按订单商品箱数合计</small></label>}
          </>}
          {selected.scope === "ordered" && <>
            <label><span>项目组</span><select aria-label="抽奖项目组" value={productValue} disabled={selectedLocked || optionsQuery.loading} onChange={e => updateSelected({
              productLine: e.target.value.startsWith("value:") ? e.target.value.slice(6) : null,
              productLineUnassigned: e.target.value === "empty", varieties: null, includeUnspecifiedVariety: false,
            })}><option value="all">全部项目组</option>{[...lineOptions].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="lottery-variety-field"><span>品种</span>{productValue === "all" ? <select aria-label="抽奖品种" disabled><option>全部品种</option></select> :
              <details className="lottery-varieties"><summary>品种：{selectedVarieties === null ? "全部" : `已选${selectedVarieties.length}项`}</summary><fieldset disabled={selectedLocked || optionsQuery.loading}><legend>选择品种</legend>
                <label><input type="checkbox" checked={selectedVarieties === null} onChange={e => changeVarieties(e.target.checked ? null : [])} />全部品种</label>
                {[...varietyOptions].map(([value,label]) => <label key={value}><input type="checkbox" checked={selectedVarieties?.includes(value) ?? false} onChange={e => changeVarieties(e.target.checked ? [...(selectedVarieties ?? []),value] : (selectedVarieties ?? []).filter(v => v !== value))} />{label}</label>)}
              </fieldset></details>}{!validVarieties && <small className="field-error" role="alert">请至少选择一个品种，或选择全部品种</small>}</div>
            <small className="lottery-filter-help">金额、箱数、吨数及加权均按匹配商品的小计计算。{optionsQuery.loading && <span>正在加载商品选项…</span>}{optionsQuery.error && <button type="button" disabled={optionsQuery.loading} onClick={() => void optionsQuery.refresh()}>重试</button>}</small>
          </>}
          <label className="check-setting repeat-setting"><input type="checkbox" checked={selectedIndex === 0 ? false : selected.excludeWinners} disabled={selectedLocked || selectedIndex === 0} onChange={(e) => updateSelected({ excludeWinners: e.target.checked })} /><span><b>排除本活动已中奖客户</b><small>{selectedIndex === 0 ? "第一轮暂无历史中奖客户，无需设置" : "按白名单客户 ID 避免跨轮次重复中奖"}</small></span></label>
          <div className="rule-summary"><span>当前规则</span><p>{ruleSummary}</p></div>
          <div className="candidate-preview"><div><span>候选客户人数</span><strong>{previewLoading ? "试算中…" : resolvedCandidateCount == null ? "待试算" : <>{resolvedCandidateCount}<small> 人</small></>}</strong>
            {preview && preview.unawardedCount > 0 && <small className="field-error">候选不足，当前可中奖{preview.actualWinnerCount}人，空缺{preview.unawardedCount}人</small>}
            {preview && (preview.missingTonnageCustomers ?? 0) > 0 && <small className="field-help">{preview.missingTonnageCustomers}名客户的匹配商品缺少部分吨数换算信息，缺失部分按0计；吨数加权排除合计为0的客户</small>}
          </div><div className="candidate-preview-actions"><button type="button" disabled={previewLoading || !validVarieties || completedCount != null} onClick={() => void candidateQuery.refresh()}>手动试算</button><button type="button" disabled={previewLoading || !preview} onClick={() => setPreviewOpen(true)}>查看候选名单</button></div></div>
        </section>
      </div>
      {previewOpen && preview && <div className="order-drawer-backdrop"><aside className="order-drawer candidate-drawer" onClick={(e) => e.stopPropagation()}><header><div><span>本次试算候选名单</span><h2>{selected.name} · {resolvedCandidateCount} 人</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="candidate-funnel">{candidateSteps.map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div><div className="candidate-table">{preview.candidates.map((candidate, index) => <div key={candidate.activityCustomerId}><span>{String(index + 1).padStart(3, "0")}</span><b>{candidate.dealerFullName}</b><em>{candidate.customerType === "SPECIAL" ? "特渠" : candidate.customerType === "GENERAL" ? "综合" : "全部客户"}</em><small>ID {candidate.activityCustomerId} · {candidate.branchName || candidate.regionCode || "—"}{qualifyingOrderDisplay(candidate, selected)}</small></div>)}{preview.candidates.length === 0 && <div className="table-empty">当前没有符合条件的候选客户</div>}</div><footer><small>权重占比为首位抽中概率；正式候选将在开始抽奖时重新计算</small><button className="admin-primary" onClick={() => setPreviewOpen(false)}>关闭</button></footer></aside></div>}
    </div>
  );
}
