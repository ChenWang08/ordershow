/** Serial reads; real changes always retain one trailing refresh. */
export function createRefreshQueue(work: () => Promise<void>, now = () => Date.now(),
  schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  }) {
  let disposed = false;
  let pending = false;
  let running: Promise<void> | null = null;
  let lastStartedAt = -Infinity;
  let cancelPeriodic: (() => void) | null = null;
  async function drain() {
    try {
      while (pending && !disposed) {
        pending = false;
        lastStartedAt = now();
        await work();
      }
    } finally { running = null; }
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    pending = true;
    if (!running) running = Promise.resolve().then(drain);
    return running;
  }
  function periodic(): Promise<void> {
    // Browser polling and ACK recovery notifications share the same 15-second read budget.
    // A slow read still gets a trailing check once 15 seconds have elapsed since it started.
    if (disposed || pending) return running ?? Promise.resolve();
    const elapsed = now() - lastStartedAt;
    if (elapsed >= 0 && elapsed < 15000) {
      // A skipped tick must schedule the actual deadline, not wait for the next 15-second tick.
      if (!cancelPeriodic) cancelPeriodic = schedule(() => {
        cancelPeriodic = null;
        void periodic().catch(() => {});
      }, 15000 - elapsed);
      return running ?? Promise.resolve();
    }
    cancelPeriodic?.(); cancelPeriodic = null;
    return refresh();
  }
  function invalidate(data?: unknown): Promise<void> {
    try {
      if (typeof data === "string" && JSON.parse(data)?.reason === "RECOVERY") return periodic();
    } catch { /* Unknown notification formats must still trigger a full refresh. */ }
    return refresh();
  }
  return { refresh, periodic, invalidate, dispose() { disposed = true; pending = false; cancelPeriodic?.(); cancelPeriodic = null; } };
}
