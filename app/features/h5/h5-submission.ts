import { ApiError } from "../../services/api/client";
import type { RuntimeOrder } from "../../services/api/types";

export type SubmissionBody = { expectedVersion: number; items: Array<{ productId: number; quantity: number }> };
export type SubmissionScope = { activityCode: string; customerId: number };
export type PendingSubmission = { format: 1; key: string; createdAt: number; scope: SubmissionScope; body: SubmissionBody };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Options = {
  send: (pending: PendingSubmission, signal: AbortSignal) => Promise<RuntimeOrder>;
  storage: () => StorageLike | undefined;
  now?: () => number;
  uuid?: () => string;
  sleep?: (ms: number) => Promise<void>;
};
const RECOVERY_MS = 24 * 60 * 60 * 1000; // Deliberately shorter than the server's 30-day minimum.
function normalized(body: SubmissionBody): SubmissionBody {
  return { expectedVersion: body.expectedVersion, items: body.items.map(item => ({ ...item })).sort((a,b) => a.productId-b.productId) };
}
export function submissionNeedsRecovery(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429
    || ["REQUEST_IN_PROGRESS", "SUBMISSION_PENDING"].includes(error.code);
}

/** One immutable command per customer/activity; uncertain outcomes survive retries and reloads. */
export function createH5SubmissionManager(options: Options) {
  const memory = new Map<string, PendingSubmission>();
  const running = new Map<string, Promise<RuntimeOrder>>();
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const storageKey = (scope: SubmissionScope) => "order-show.h5.submit.v1." + encodeURIComponent(scope.activityCode) + "." + scope.customerId;
  function read(scope: SubmissionScope) {
    const id = storageKey(scope);
    if (memory.has(id)) return memory.get(id)!;
    let raw: string | null | undefined;
    try { raw = options.storage()?.getItem(id); } catch { return undefined; }
    if (!raw) return undefined;
    try {
      const pending = JSON.parse(raw) as PendingSubmission;
      if (pending.format !== 1 || typeof pending.key !== "string" || !pending.key || !Number.isFinite(pending.createdAt)
          || pending.scope.activityCode !== scope.activityCode || pending.scope.customerId !== scope.customerId
          || !Number.isSafeInteger(pending.body.expectedVersion) || pending.body.expectedVersion < 0
          || !Array.isArray(pending.body.items) || !pending.body.items.length || pending.body.items.length > 1000
          || !pending.body.items.every(item => Number.isSafeInteger(item.productId) && item.productId > 0
            && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 999999)) throw new Error();
      memory.set(id, pending);
      return pending;
    } catch { throw new ApiError(409, "SUBMISSION_RECOVERY_EXPIRED", "上次提交记录无法恢复，请加载最新订单核对"); }
  }
  function clear(scope: SubmissionScope) {
    const id = storageKey(scope);
    memory.delete(id);
    try { options.storage()?.removeItem(id); } catch { /* In-memory retry remains available if storage is blocked. */ }
  }
  function save(pending: PendingSubmission) {
    const id = storageKey(pending.scope);
    memory.set(id,pending);
    try { options.storage()?.setItem(id,JSON.stringify(pending)); } catch { /* Private browsing may deny storage. */ }
  }
  async function execute(pending: PendingSubmission) {
    if (now() - pending.createdAt > RECOVERY_MS || pending.createdAt > now())
      throw new ApiError(409,"SUBMISSION_RECOVERY_EXPIRED","上次提交已超过自动恢复时间，请加载最新订单核对");
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(),20_000);
      try {
        const order = await options.send(pending,controller.signal);
        clear(pending.scope);
        return order;
      } catch (error) {
        const uncertain = submissionNeedsRecovery(error);
        if (!uncertain && (!(error instanceof ApiError) || ![401,403].includes(error.status))) clear(pending.scope);
        const delay = error instanceof ApiError ? Math.max(1000,error.retryAfterMs ?? 1000) : 1000;
        if (!uncertain || attempt >= 1 || delay > 10_000) throw error;
        clearTimeout(timer);
        await sleep(delay);
      } finally { clearTimeout(timer); }
    }
  }
  function run(pending: PendingSubmission) {
    const id = storageKey(pending.scope);
    const existing = running.get(id);
    if (existing) return existing;
    const result = execute(pending).finally(() => running.delete(id));
    running.set(id,result);
    return result;
  }
  return {
    read, clear,
    recover(scope: SubmissionScope) {
      const pending = read(scope);
      return pending ? run(pending) : Promise.resolve(null);
    },
    submit(scope: SubmissionScope, request: SubmissionBody) {
      const body = normalized(request);
      let pending = read(scope);
      if (pending && JSON.stringify(pending.body) !== JSON.stringify(body))
        throw new ApiError(409,"SUBMISSION_PENDING","请先确认上次提交结果，再修改订单");
      if (!pending) {
        pending = { format: 1, key: (options.uuid ?? (() => crypto.randomUUID()))(), createdAt: now(), scope: { ...scope }, body };
        save(pending);
      }
      return run(pending);
    },
  };
}
