import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadModule } from "./helpers/load-ts-module.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join("");
  if (element == null || typeof element === "boolean") return "";
  return typeof element === "object" ? text(element.props?.children) : String(element);
}

// Exercise the actual component handlers and effect cleanup, including out-of-order responses.
function harness(statuses, options = {}) {
  const calls = [];
  const serverRounds = statuses.map((status, index) => ({
    id: index + 1, name: `第${index + 1}轮`, status, prizeName: `奖品${index + 1}`,
    winnerCount: 1, customerType: "ALL", candidateScope: "ALL", minimumOrderAmount: 0,
  }));
  let winners = serverRounds.filter((round) => ["DRAWN", "COMPLETED"].includes(round.status))
    .map((round) => ({ roundId: round.id, position: 1, dealerDisplayName: `客户${round.id}` }));
  const response = () => structuredClone({ rules: [{ id: 1, status: "PUBLISHED", rounds: serverRounds }], winners });
  const slots = [], pendingEffects = [];
  let cursor = 0, tree;
  const react = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial;
      return [slots[id], (next) => { slots[id] = typeof next === "function" ? next(slots[id]) : next; }];
    },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useEffect(effect, deps) {
      const id = cursor++, previous = slots[id];
      if (!previous || deps.some((dep, index) => !Object.is(dep, previous.deps[index]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); slots[id] = { deps, cleanup: effect() }; });
      }
    },
  };
  const api = {
    ApiError: class ApiError extends Error {}, apiAssetUrl: (url) => url,
    loadPublicLottery: async () => { calls.push(["load"]); return options.load ? options.load(response) : response(); },
    drawLotteryRound: async (_activity, id) => {
      calls.push(["draw", id]);
      if (options.draw) await options.draw();
      serverRounds.find((round) => round.id === id).status = "DRAWN";
      const result = [{ roundId: id, position: 1, dealerDisplayName: `客户${id}` }];
      winners = [...winners.filter((winner) => winner.roundId !== id), ...result];
      return { winners: result };
    },
    completeLotteryRound: async (_activity, id) => {
      calls.push(["complete", id]);
      serverRounds.find((round) => round.id === id).status = "COMPLETED";
    },
  };
  const { LotteryBoard, mapLotteryRule } = loadModule("app/features/lottery/Lottery.tsx", {
    react, "../../api": api, "../shared/utils": { normalizeSearchText: (value) => value },
    "../shared/components/FestivalDecor": { FestivalDecor: () => null },
  }, { window: { setInterval: () => 1, clearInterval() {} } });
  const props = { activityId: 1, activityFinished: false, attendanceRows: [],
    rounds: mapLotteryRule(response().rules[0]),
    onComplete(id) { props.rounds = props.rounds.map((round) => round.id === id ? { ...round, status: "completed", serverStatus: "COMPLETED" } : round); },
  };
  const render = () => { cursor = 0; tree = LotteryBoard(props); pendingEffects.splice(0).forEach((effect) => effect()); return tree; };
  const find = (predicate) => nodes(tree).find(predicate);
  const select = () => find((node) => node.type === "select");
  const action = () => find((node) => node.props?.className?.startsWith("lottery-action"));
  return {
    calls, props, serverRounds, options, render, select, action, text: () => text(tree),
    async flush() { for (let i = 0; i < 3; i++) { render(); await settle(); } render(); },
    choose(id) { select().props.onChange({ target: { value: String(id) } }); render(); },
    async click() { await action().props.onClick(); render(); },
    retry() { find((node) => node.type === "button" && text(node) === "重新加载").props.onClick(); render(); },
    replaceWinner(id, name) { winners = winners.map((winner) => winner.roundId === id ? { ...winner, dealerDisplayName: name } : winner); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("completed rounds can be reviewed before event end without advancing or skipping draws", async () => {
  const h = harness(["COMPLETED", "PUBLISHED", "PUBLISHED"]);
  await h.flush();
  assert.equal(h.select().props.value, "2");
  h.choose(1); await h.flush();
  assert.match(h.text(), /客户1/);
  assert.match(h.text(), /本轮已完成 · 仅回看/);
  await h.click();
  h.choose(3); await h.flush();
  assert.match(h.text(), /请先完成前面的轮次/);
  assert.equal(h.action().props.disabled, true);
  await h.click();
  h.choose(2); await h.flush();
  assert.match(h.text(), /开始抽奖/);
  assert.equal(h.calls.some(([kind]) => kind === "draw" || kind === "complete"), false);
  h.unmount();
});

test("all completed rounds default to the last round on entry and permit read-only selection", async () => {
  for (const activityFinished of [false, true]) {
    const h = harness(["COMPLETED", "COMPLETED"]);
    h.props.activityFinished = activityFinished;
    await h.flush();
    assert.equal(h.select().props.value, "2");
    assert.match(h.text(), /客户2/);
    h.choose(1); await h.flush();
    assert.match(h.text(), /客户1/);
    assert.doesNotMatch(h.text(), /客户2/);
    assert.equal(h.action().props.disabled, true);
    h.unmount();
  }
});

test("draw, reveal and complete remain separate; review preserves the drawn round and then advances", async () => {
  const h = harness(["COMPLETED", "PUBLISHED", "PUBLISHED"]);
  await h.flush();
  await h.click();
  assert.match(h.text(), /停止并揭晓/);
  assert.equal(h.select().props.disabled, true);
  h.choose(1);
  assert.equal(h.select().props.value, "2");
  await h.click();
  assert.match(h.text(), /完成本轮抽奖/);
  assert.match(h.text(), /客户2/);
  h.choose(1); await h.flush();
  h.choose(2); await h.flush();
  assert.match(h.text(), /客户2/);
  assert.match(h.text(), /完成本轮抽奖/);
  assert.equal(h.calls.filter(([kind]) => kind === "complete").length, 0);
  await h.click(); await h.flush();
  assert.equal(h.select().props.value, "3");
  assert.match(h.text(), /开始抽奖/);
  assert.doesNotMatch(h.text(), /客户2/);
  await h.click(); await h.click(); await h.click(); await h.flush();
  assert.equal(h.select().props.value, "3");
  assert.match(h.text(), /全部轮次已完成/);
  h.choose(2); await h.flush();
  assert.match(h.text(), /客户2/);
  assert.deepEqual(h.calls.filter(([kind]) => kind !== "load"), [["draw", 2], ["complete", 2], ["draw", 3], ["complete", 3]]);
  h.unmount();
});

test("an already drawn round resumes its saved result without drawing or completing automatically", async () => {
  const h = harness(["COMPLETED", "DRAWN"]);
  await h.flush();
  assert.match(h.text(), /客户2/);
  assert.match(h.text(), /完成本轮抽奖/);
  assert.equal(h.calls.every(([kind]) => kind === "load"), true);
  h.props.activityFinished = true; await h.flush();
  assert.match(h.text(), /活动已结束 · 仅可回看/);
  await h.click();
  assert.equal(h.calls.every(([kind]) => kind === "load"), true);
  h.unmount();
});

test("late responses from previous selections cannot overwrite the current winners", async () => {
  const h = harness(["COMPLETED", "COMPLETED"]);
  await h.flush();
  const first = deferred(), second = deferred();
  let count = 0;
  h.options.load = (response) => (++count === 1 ? first.promise : second.promise).then(() => response());
  h.choose(1);
  assert.doesNotMatch(h.text(), /客户2/);
  h.choose(2);
  second.resolve(); await h.flush();
  assert.match(h.text(), /客户2/);
  first.resolve(); await h.flush();
  assert.equal(h.select().props.value, "2");
  assert.match(h.text(), /客户2/);
  assert.doesNotMatch(h.text(), /客户1/);
  h.unmount();
});

test("failed reads expose retry and block actions; revisiting loads the latest effective result", async () => {
  const h = harness(["COMPLETED", "PUBLISHED"], { load: async () => { throw new Error("offline"); } });
  await h.flush();
  assert.match(h.text(), /重新加载/);
  assert.equal(h.action().props.disabled, true);
  await h.click();
  h.options.load = null; h.retry(); await h.flush();
  h.choose(1); await h.flush();
  assert.match(h.text(), /客户1/);
  h.choose(2); await h.flush();
  h.replaceWinner(1, "重抽后的客户");
  h.choose(1); await h.flush();
  assert.match(h.text(), /重抽后的客户/);
  assert.doesNotMatch(h.text(), /客户1/);
  h.unmount();
});

test("submission locks selection and prevents a double-click from issuing duplicate draws", async () => {
  const pending = deferred();
  const h = harness(["PUBLISHED", "PUBLISHED"], { draw: () => pending.promise });
  await h.flush();
  const handler = h.action().props.onClick;
  const first = handler();
  await handler(); h.render();
  assert.equal(h.select().props.disabled, true);
  h.choose(2);
  assert.equal(h.select().props.value, "1");
  assert.equal(h.calls.filter(([kind]) => kind === "draw").length, 1);
  pending.resolve(); await first; h.render();
  assert.match(h.text(), /停止并揭晓/);
  h.unmount();
});

test("finished events with unplayed rounds default to the latest result and keep unplayed rounds read-only", async () => {
  const h = harness(["COMPLETED", "PUBLISHED"]);
  h.props.activityFinished = true;
  await h.flush();
  assert.equal(h.select().props.value, "1");
  h.choose(2); await h.flush();
  assert.match(h.text(), /本轮未开奖/);
  assert.equal(h.action().props.disabled, true);
  await h.click();
  assert.equal(h.calls.every(([kind]) => kind === "load"), true);
  h.unmount();
});
