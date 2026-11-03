import type { DealerCandidate } from "../../api";

/** Owned by one authorized activity workspace, never persisted in browser storage. */
export function createDealerCandidateCache(load: (signal: AbortSignal) => Promise<DealerCandidate[]>, now = Date.now) {
  let value: DealerCandidate[] | undefined, expiresAt = 0, generation = 0;
  let flight: { controller: AbortController; promise: Promise<DealerCandidate[]> } | undefined;
  const clear = () => {
    generation++; value = undefined; expiresAt = 0;
    flight?.controller.abort(); flight = undefined;
  };
  return {
    clear,
    read(): Promise<DealerCandidate[]> {
      if (value && now() < expiresAt) return Promise.resolve(value);
      if (flight) return flight.promise;
      const version = generation, controller = new AbortController();
      const current = { controller, promise: Promise.resolve([] as DealerCandidate[]) };
      current.promise = Promise.resolve().then(() => load(controller.signal)).then(rows => {
        if (version !== generation || controller.signal.aborted) throw new Error("客户名单已变化，请重新打开选择窗口。");
        value = rows; expiresAt = now() + 60_000;
        return rows;
      }).finally(() => { if (flight === current) flight = undefined; });
      flight = current;
      return current.promise;
    },
  };
}
export type DealerCandidateCache = ReturnType<typeof createDealerCandidateCache>;
