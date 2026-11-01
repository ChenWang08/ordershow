import type { OrderChangeRequest, RuntimeIdentity, RuntimeOrder } from "../../api";
import { h5OrderItems, h5QuantitySignature } from "./h5-domain";

export type H5DraftItems = Array<{ productId: number; quantity: number }>;
export type H5DraftScope = Pick<RuntimeIdentity, "activityId" | "activityCode" | "customerId">;
export type H5DraftContext = H5DraftScope & {
  endsAt: string;
  order: RuntimeOrder | null;
  request: OrderChangeRequest | null;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LocalDraft = {
  format: 1;
  scope: H5DraftScope;
  baseline: string;
  items: H5DraftItems;
  updatedAt: number;
  expiresAt: number;
};
export const H5_LOCAL_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function h5LocalDraftKey(scope: H5DraftScope) {
  return `order-show:h5-cart:v1:${scope.activityId}:${encodeURIComponent(scope.activityCode)}:${scope.customerId}`;
}

// A lock change or an application change can invalidate edits without changing the business version.
export function h5DraftBaseline(order: RuntimeOrder | null, request: OrderChangeRequest | null) {
  return JSON.stringify([
    order ? [order.id, order.currentVersion, order.lockVersion, order.status, h5QuantitySignature(h5OrderItems(order))] : null,
    request ? [request.id, request.orderId, request.requestType, request.status, request.baseVersion, request.currentVersion,
      request.originalOrder?.lockVersion ?? null, h5QuantitySignature(request.items.map(({ productId, quantity }) => ({ productId, quantity }))), request.requestedAt,
      request.reviewedAt ?? null] : null,
  ]);
}

export function h5DraftBaseItems(order: RuntimeOrder | null, request: OrderChangeRequest | null): H5DraftItems {
  return request?.requestType === "MODIFY" ? request.items.map(({ productId, quantity }) => ({ productId, quantity })) : h5OrderItems(order);
}

function validItems(items: unknown): items is H5DraftItems {
  if (!Array.isArray(items)) return false;
  const ids = new Set<number>();
  return items.every(item => {
    if (!item || !Number.isSafeInteger(item.productId) || item.productId <= 0 || ids.has(item.productId)
      || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 999999) return false;
    ids.add(item.productId);
    return true;
  });
}

export function createH5LocalDraftStore({ storage, now = Date.now }: { storage: () => StorageLike | undefined; now?: () => number }) {
  // Memory remains usable if browser storage is blocked/full. No HTTP fallback.
  const memory = new Map<string, string | null>();
  const persist = (key: string, value: string | null) => {
    memory.set(key, value);
    try {
      const target = storage();
      if (!target) return false;
      if (value == null) target.removeItem(key);
      else target.setItem(key, value);
      memory.delete(key);
      return true;
    } catch { return false; }
  };
  const remove = (scope: H5DraftScope) => persist(h5LocalDraftKey(scope), null);
  const read = (context: H5DraftContext) => {
    const key = h5LocalDraftKey(context);
    let raw: string | null = memory.get(key) ?? null;
    let persistent = !memory.has(key);
    if (memory.has(key)) persistent = persist(key, raw);
    else {
      try { const target = storage(); persistent = Boolean(target); raw = target?.getItem(key) ?? null; }
      catch { persistent = false; }
    }
    if (!raw) return { draft: null, reason: "none" as const, persistent };
    try {
      const draft = JSON.parse(raw) as LocalDraft;
      if (!draft || draft.format !== 1 || !draft.scope || draft.scope.activityId !== context.activityId
        || draft.scope.activityCode !== context.activityCode || draft.scope.customerId !== context.customerId || typeof draft.baseline !== "string"
        || !validItems(draft.items) || !Number.isFinite(draft.updatedAt) || !Number.isFinite(draft.expiresAt)
        || draft.updatedAt > now() || draft.expiresAt <= draft.updatedAt
        || draft.expiresAt - draft.updatedAt > H5_LOCAL_DRAFT_MAX_AGE_MS) throw new Error("Invalid local cart");
      if (Math.min(draft.expiresAt, Date.parse(context.endsAt)) <= now() || !Number.isFinite(Date.parse(context.endsAt))) {
        return { draft: null, reason: "expired" as const, persistent: remove(context) };
      }
      if (draft.baseline !== h5DraftBaseline(context.order, context.request)) {
        return { draft: null, reason: "stale" as const, persistent: remove(context) };
      }
      return { draft: { ...draft, items: draft.items.map(({ productId, quantity }) => ({ productId, quantity })) }, reason: "restored" as const, persistent };
    } catch { return { draft: null, reason: "invalid" as const, persistent: remove(context) }; }
  };
  const save = (context: H5DraftContext, items: H5DraftItems) => {
    if (!validItems(items)) return false;
    const updatedAt = now();
    const expiresAt = Math.min(Date.parse(context.endsAt), updatedAt + H5_LOCAL_DRAFT_MAX_AGE_MS);
    if (!Number.isFinite(expiresAt) || expiresAt <= updatedAt) return remove(context);
    const { activityId, activityCode, customerId } = context;
    const draft: LocalDraft = { format: 1, scope: { activityId, activityCode, customerId },
      baseline: h5DraftBaseline(context.order, context.request), items: items.map(({ productId, quantity }) => ({ productId, quantity })), updatedAt, expiresAt };
    return persist(h5LocalDraftKey(context), JSON.stringify(draft));
  };
  return { read, save, remove };
}
