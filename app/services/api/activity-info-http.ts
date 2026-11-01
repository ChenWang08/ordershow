import { apiBase } from "./client";
import type { RuntimeActivity } from "./types";

export type ActivityInfoConnectionState = "connecting" | "connected" | "paused" | "unavailable" | "error";
type Handlers = {
  onActivity: (activity: RuntimeActivity) => void;
  onState: (state: ActivityInfoConnectionState) => void;
};

/** One bounded request at a time. Only public metadata participates in this lifecycle. */
export function subscribeActivityInfo(activityCode: string, handlers: Handlers) {
  let stopped = false, pageHidden = false, paused = false, unavailable = false;
  let hasActivity = false, failed = false, failures = 0, etag: string | null = null;
  let timer: number | undefined, timeout: number | undefined;
  let request: AbortController | null = null;
  const hidden = () => pageHidden || document.visibilityState === "hidden";
  const clearTimer = () => { window.clearTimeout(timer); timer = undefined; };
  const cancel = () => {
    const previous = request; request = null; previous?.abort();
    window.clearTimeout(timeout); timeout = undefined;
  };
  const schedule = (delay: number) => {
    clearTimer();
    if (!stopped && !hidden() && !unavailable) timer = window.setTimeout(() => { timer = undefined; void check(); }, delay);
  };

  async function check() {
    if (stopped || hidden() || unavailable || request) return;
    const candidate = new AbortController(); request = candidate;
    const current = () => !stopped && request === candidate && !hidden();
    if (!hasActivity && !failed) handlers.onState("connecting");
    try {
      // Timeout covers response headers AND the complete JSON body.
      const response = await Promise.race([
        (async () => {
          const result = await fetch(`${apiBase()}/public/activities/${encodeURIComponent(activityCode)}`, {
            signal: candidate.signal, credentials: "omit", cache: "no-store",
            headers: { Accept: "application/json", ...(etag ? { "If-None-Match": etag } : {}) },
          });
          if (result.status === 304) return { result, activity: null };
          if (!result.ok) throw Object.assign(new Error("Activity request failed"), { status: result.status });
          const body = await result.json() as { data?: RuntimeActivity };
          if (body.data?.code !== activityCode || !Number.isSafeInteger(body.data.id)
            || typeof body.data.name !== "string" || typeof body.data.status !== "string") {
            throw new Error("Invalid activity response");
          }
          return { result, activity: body.data };
        })(),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => { candidate.abort(); reject(new Error("Activity request timed out")); }, 10_000);
        }),
      ]);
      if (!current()) return;
      if (response.result.status === 304 && !hasActivity) { etag = null; throw new Error("Initial activity cannot be empty"); }
      if (response.activity) { handlers.onActivity(response.activity); hasActivity = true; }
      etag = response.result.headers.get("ETag") || (response.result.status === 304 ? etag : null);
      failures = 0; failed = false; handlers.onState("connected");
      schedule(Math.round(30_000 * (0.9 + Math.random() * 0.2)));
    } catch (error) {
      if (!current()) return;
      failed = true;
      const status = (error as { status?: number }).status;
      unavailable = status === 404 || status === 410;
      handlers.onState(unavailable ? "unavailable" : "error");
      const delay = Math.min(30_000, 2000 * 2 ** Math.min(failures++, 4));
      schedule(Math.round(delay * (0.9 + Math.random() * 0.2)));
    } finally {
      if (request === candidate) {
        request = null; window.clearTimeout(timeout); timeout = undefined;
      }
    }
  }

  const resume = () => {
    if (hidden()) {
      paused = true; clearTimer(); cancel(); handlers.onState("paused");
    } else if (paused) {
      paused = false; unavailable = false; clearTimer();
      handlers.onState(failed ? "error" : hasActivity ? "connected" : "connecting");
      void check();
    }
  };
  const leave = () => { pageHidden = true; resume(); };
  const returnToPage = () => { pageHidden = false; resume(); };
  const retry = () => {
    if (stopped || hidden() || request) return;
    unavailable = false; clearTimer(); void check();
  };
  const online = () => { if (failed) retry(); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", returnToPage);
  window.addEventListener("online", online);
  if (hidden()) resume(); else void check();
  const stop = () => {
    stopped = true; clearTimer(); cancel();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", returnToPage);
    window.removeEventListener("online", online);
  };
  stop.retry = retry;
  return stop;
}
