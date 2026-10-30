import { apiBase } from "./client";
import type { RuntimeActivity } from "./types";

export type ActivityInfoConnectionState = "connecting" | "connected" | "paused" | "unavailable" | "unsupported";
type Snapshot = { activityId: number; version: string; serverTime: string; heartbeatIntervalMs?: number; activity: RuntimeActivity };
type Handlers = {
  onActivity: (activity: RuntimeActivity) => void;
  onState: (state: ActivityInfoConnectionState) => void;
};

/** One lifecycle owner per workspace. Reconnects carry a current snapshot, never an outbox replay. */
export function subscribeActivityInfo(activityCode: string, handlers: Handlers) {
  let stopped = false, unavailable = false, pageHidden = false;
  let source: EventSource | null = null;
  let retry: number | undefined, watchdog: number | undefined;
  let failures = 0, hasSnapshot = false, lastVersion = BigInt(-1), lastTime = -1, watchdogMs = 90_000;

  const clearRetry = () => { window.clearTimeout(retry); retry = undefined; };
  const close = () => {
    window.clearTimeout(watchdog); watchdog = undefined;
    const previous = source; source = null; previous?.close();
  };
  const hidden = () => document.visibilityState === "hidden" || pageHidden;
  const current = (candidate: EventSource) => !stopped && source === candidate;

  const scheduleRetry = () => {
    if (stopped || unavailable || hidden() || retry !== undefined) return;
    handlers.onState("connecting");
    const base = Math.min(30_000, 2000 * 2 ** Math.min(failures++, 4));
    const delay = Math.min(30_000, Math.round(base * (0.8 + Math.random() * 0.4)));
    retry = window.setTimeout(() => { retry = undefined; connect(); }, delay);
  };
  const failed = (candidate: EventSource) => {
    if (!current(candidate)) return;
    close(); scheduleRetry();
  };
  const received = (candidate: EventSource, interval?: number) => {
    if (!current(candidate)) return;
    if (interval !== undefined && Number.isFinite(interval) && interval >= 1000) {
      watchdogMs = Math.max(90_000, Math.min(3_600_000, interval * 3));
    }
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => failed(candidate), watchdogMs);
  };

  function connect() {
    if (stopped || unavailable || hidden() || source) return;
    if (typeof EventSource === "undefined") { handlers.onState("unsupported"); return; }
    handlers.onState("connecting");
    let candidate: EventSource;
    try { candidate = new EventSource(`${apiBase()}/public/activities/${encodeURIComponent(activityCode)}/events`); }
    catch { scheduleRetry(); return; }
    source = candidate;
    received(candidate); // Also bounds a connection which opens but never sends its first snapshot.
    candidate.onopen = () => received(candidate);
    candidate.onerror = () => failed(candidate); // close() disables the browser's separate retry loop.
    candidate.addEventListener("activity", event => {
      if (!current(candidate)) return;
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as Snapshot;
        if (snapshot.activity?.code !== activityCode || snapshot.activityId !== snapshot.activity.id
          || typeof snapshot.version !== "string" || !/^\d+$/.test(snapshot.version)
          || !Number.isFinite(Date.parse(snapshot.serverTime))) throw new Error("Invalid activity snapshot");
        received(candidate, snapshot.heartbeatIntervalMs);
        const version = BigInt(snapshot.version), time = Date.parse(snapshot.serverTime);
        if (version > lastVersion || (version === lastVersion && time > lastTime)) {
          const changed = version > lastVersion;
          lastVersion = version; lastTime = time;
          // A same-version snapshot may advance its time-derived status without changing configuration.
          if (changed || !hasSnapshot || snapshot.activity.status !== lastStatus) {
            lastStatus = snapshot.activity.status;
            handlers.onActivity(snapshot.activity);
          }
          hasSnapshot = true;
        }
        failures = 0;
        if (hasSnapshot) handlers.onState("connected");
      } catch { failed(candidate); }
    });
    candidate.addEventListener("heartbeat", event => {
      if (!current(candidate)) return;
      try {
        const heartbeat = JSON.parse((event as MessageEvent<string>).data) as { heartbeatIntervalMs?: number };
        received(candidate, heartbeat.heartbeatIntervalMs);
      } catch { failed(candidate); }
    });
    candidate.addEventListener("unavailable", () => {
      if (!current(candidate)) return;
      unavailable = true; close(); clearRetry(); handlers.onState("unavailable");
    });
  }
  let lastStatus = "";

  const resume = () => {
    if (hidden()) { close(); clearRetry(); handlers.onState("paused"); }
    else if (retry === undefined) connect();
  };
  const leave = () => { pageHidden = true; resume(); };
  const returnToPage = () => { pageHidden = false; resume(); };
  const online = () => { if (!source) { clearRetry(); resume(); } };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", returnToPage);
  window.addEventListener("focus", resume);
  window.addEventListener("online", online);
  resume();
  return () => {
    stopped = true; close(); clearRetry();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", returnToPage);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", online);
  };
}
