import { api } from "./client";
import { activeActivityPath } from "./context";
import type { Envelope, LotteryCandidatePreview, LotteryDrawResult, LotteryRoundApi, LotteryRuleApi, LotteryWinnerApi, LotteryWinnerStatistics } from "./types";

export async function loadLotteryRules(activityId: number) { return (await api<Envelope<LotteryRuleApi[]>>(`/admin/activities/${activityId}/lottery/rules`)).data; }
export async function loadPublicLottery() { return (await api<Envelope<{ rules: LotteryRuleApi[]; winners: LotteryWinnerApi[] }>>(`/public/activities/${activeActivityPath()}/lottery`)).data; }
export async function createLotteryRule(activityId: number, body: { name: string; rounds: Array<Record<string, unknown>> }) {
  return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateLotteryRule(activityId: number, ruleId: number, body: { name: string; rounds: Array<Record<string, unknown>> }) {
  return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules/${ruleId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function publishLotteryRule(activityId: number, ruleId: number) { return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules/${ruleId}/publish`, { method: "POST" }, "admin")).data; }
export async function previewLotteryCandidates(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<LotteryCandidatePreview>>(`/admin/activities/${activityId}/lottery/candidates/preview`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function loadLotteryStatistics(activityId: number) { return (await api<Envelope<LotteryWinnerStatistics>>(`/admin/activities/${activityId}/lottery/statistics`, {}, "admin")).data; }
export async function drawLotteryRound(activityId: number, roundId: number) { return (await api<Envelope<LotteryDrawResult>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/draw`, { method: "POST" }, "admin")).data; }
export async function completeLotteryRound(activityId: number, roundId: number) { return (await api<Envelope<LotteryRoundApi>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/complete`, { method: "POST" }, "admin")).data; }
export async function resetLotteryRound(activityId: number, roundId: number, reason: string) { return (await api<Envelope<LotteryRoundApi>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/reset`, { method: "POST", body: JSON.stringify({ reason }) }, "admin")).data; }

