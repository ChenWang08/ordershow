import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ApiError } = loadModule("app/services/api/client.ts");
const identity = {
  id: 7, username: "member", displayName: "测试成员", roleCode: "DEPARTMENT_MEMBER",
  departmentId: 3, permissions: ["ORDER"], mustChangePassword: false, csrfToken: "test-only",
};

function gatewayHarness() {
  const slots = [], effects = [], owners = [], timers = new Map(), listeners = new Map();
  let cursor = 0, timerId = 0, requests = 0, tree;
  let me = async () => identity;
  const { AdminGateway } = loadModule("app/features/admin/AdminGateway.tsx", {
    "../../api": {
      ApiError, adminMe: () => { requests++; return me(); },
      setAdminPreferenceOwner: owner => owners.push(owner),
    },
    "../../admin-context": {
      AdminIdentityContext: { Provider: "identity-provider" },
      AdminSessionContext: { Provider: "session-provider" },
    },
    react: {
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useEffect(effect, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          slots[index] = { deps };
          effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
        }
      },
    },
  }, { window: {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
    setInterval(callback, delay) { assert.equal(delay, 15000); timers.set(++timerId, callback); return timerId; },
    clearInterval: id => timers.delete(id),
  } });
  function render() {
    cursor = 0;
    tree = AdminGateway({ children: "workspace" });
    effects.splice(0).forEach(effect => effect());
  }
  async function flush() { await settle(); render(); await settle(); render(); }
  render();
  return {
    owners, timers,
    get tree() { return tree; },
    get requests() { return requests; },
    respond: callback => { me = callback; },
    flush,
    async check(event = "admin-permissions-changed") {
      const callbacks = listeners.get(event) || [];
      for (const callback of [...callbacks]) callback();
      await flush();
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function expectWorkspace(harness) {
  assert.equal(harness.tree.type, "identity-provider", "the authenticated workspace must stay mounted");
  assert.equal(harness.tree.props.value.id, identity.id);
  assert.equal(harness.owners.includes(null), false, "the account's activity preference must be retained");
}

test("event-triggered checks retain the workspace on temporary failures and recover without polling", async () => {
  const h = gatewayHarness();
  await h.flush();
  expectWorkspace(h);
  assert.equal(h.timers.size, 0, "login must not install a polling timer");
  const failures = [
    new TypeError("Failed to fetch"), new ApiError(500, "INTERNAL_ERROR", "busy"),
    new ApiError(502, "REQUEST_FAILED", "gateway"), new ApiError(503, "REQUEST_FAILED", "busy"),
    new ApiError(504, "REQUEST_FAILED", "timeout"), new SyntaxError("Truncated JSON"),
  ];
  for (const failure of failures) {
    h.respond(async () => { throw failure; });
    await h.check();
    expectWorkspace(h);
  }
  h.respond(async () => ({ ...identity, displayName: "连接恢复", permissions: ["PRODUCT"] }));
  await h.check();
  expectWorkspace(h);
  assert.equal(h.tree.props.value.displayName, "连接恢复");
  assert.deepEqual(h.tree.props.value.permissions, ["PRODUCT"]);
  assert.equal(h.requests, 8);
  h.unmount();
  assert.equal(h.timers.size, 0);
});

test("focus and permission refresh also preserve login on temporary failures", async () => {
  const h = gatewayHarness();
  await h.flush();
  h.respond(async () => { throw new TypeError("offline"); });
  await h.check("focus");
  expectWorkspace(h);
  await h.check("admin-permissions-changed");
  expectWorkspace(h);
  h.unmount();
});

test("a confirmed expired or revoked session still returns to login", async () => {
  const h = gatewayHarness();
  await h.flush();
  h.respond(async () => { throw new ApiError(401, "UNAUTHORIZED", "登录已失效"); });
  await h.check();
  assert.equal(h.tree.type, "section");
  assert.equal(h.owners.at(-1), null);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test("an account or access scope change still clears the previous workspace", async () => {
  for (const change of [{ id: 8 }, { departmentId: 4 }, { roleCode: "DEPARTMENT_ADMIN" }]) {
    const h = gatewayHarness();
    await h.flush();
    h.respond(async () => ({ ...identity, ...change }));
    await h.check("focus");
    assert.equal(h.tree.type, "section");
    assert.equal(h.owners.at(-1), null);
    h.unmount();
  }
});

test("a late unauthorized response after unmount cannot clear another login", async () => {
  const h = gatewayHarness();
  await h.flush();
  let rejectCheck;
  h.respond(() => new Promise((_resolve, reject) => { rejectCheck = reject; }));
  await h.check();
  h.unmount();
  rejectCheck(new ApiError(401, "UNAUTHORIZED", "expired"));
  await settle();
  assert.deepEqual(h.owners, [identity.id]);
});

test("401 from any admin operation invalidates login without waiting for focus", async () => {
  const h = gatewayHarness(); await h.flush();
  await h.check("admin-session-invalid");
  assert.equal(h.tree.type, "section");
  assert.equal(h.owners.at(-1), null);
  h.unmount();
});

test("focus storms and simultaneous permission events share a pending identity check", async () => {
  const h = gatewayHarness(); await h.flush();
  let resolve;
  h.respond(() => new Promise(yes => { resolve = yes; }));
  await h.check("focus");
  await h.check("focus");
  await h.check("admin-permissions-changed");
  assert.equal(h.requests, 2);
  resolve(identity); await h.flush();
  assert.equal(h.timers.size, 0);
  h.unmount();
});
