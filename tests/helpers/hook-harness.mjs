import { setImmediate as settle } from "node:timers/promises";
import { loadModule } from "./load-ts-module.mjs";

// Executes actual hooks and nested hooks with controllable effects, network promises and clocks.
export function hookHarness(path, name, args, mocks = {}, globals = {}) {
  const slots = [], effects = [], timers = new Map(), intervals = new Map();
  let cursor = 0, timerId = 0, dirty = false, model, writes = 0;
  function memo(factory, deps) {
    const index = cursor++;
    const old = slots[index];
    if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) slots[index] = { deps, value: factory() };
    return slots[index].value;
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => {
        slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
        dirty = true; writes++;
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (callback, deps) => memo(() => callback, deps),
    useMemo: memo,
    useSyncExternalStore(subscribe, getSnapshot) {
      react.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return getSnapshot();
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) {
        slots[index] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const window = Object.defineProperties({
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval(fn) { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id),
  }, Object.getOwnPropertyDescriptors(globals.window ?? {}));
  const hook = loadModule(path, { ...mocks, react }, { ...globals, window })[name];
  function render(nextArgs = args) {
    args = nextArgs; cursor = 0; dirty = false;
    model = hook(...args);
    effects.splice(0).forEach(fn => fn());
    return model;
  }
  async function flush() {
    for (let i = 0; i < 12; i++) {
      await settle();
      if (!dirty) break;
      render();
    }
    return model;
  }
  render();
  return { render, flush, timers, intervals,
    get model() { return model; }, get writes() { return writes; },
    async runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await flush(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
