/** One in-flight refresh plus one trailing refresh, regardless of notification burst size. */
export function createRefreshQueue(work: () => Promise<void>) {
  let disposed = false;
  let pending = false;
  let running: Promise<void> | null = null;
  async function drain() {
    try {
      while (pending && !disposed) {
        pending = false;
        await work();
      }
    } finally { running = null; }
  }
  return {
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      pending = true;
      if (!running) running = Promise.resolve().then(drain);
      return running;
    },
    dispose() { disposed = true; pending = false; },
  };
}
