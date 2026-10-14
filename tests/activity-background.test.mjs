import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const api = { apiAssetUrl: path => path || "" };
const { backgroundFileError } = loadModule("app/features/shared/activity-background.ts", { "../../api": api });
test("background limits accept the exact boundary and reject excess bytes or unsupported files", () => {
  for (const [kind, mb] of [["h5", 5], ["desktop", 10]]) {
    for (const name of ["背景.JPG", "背景.jpeg", "背景.png", "背景.webp"]) {
      assert.equal(backgroundFileError({ name, size: mb * 1024 * 1024 }, kind), "");
      assert.match(backgroundFileError({ name, size: mb * 1024 * 1024 + 1 }, kind), /不能超过/);
    }
    assert.match(backgroundFileError({ name: "image.svg", size: 50 }, kind), /仅支持/);
    assert.match(backgroundFileError({ name: "image.png", size: 0 }, kind), /空文件/);
  }
});

test("background falls back while loading, on failure, on reset and when switching activities", () => {
  let loaded = "";
  let effect;
  let image;
  const { useBackgroundImage } = loadModule("app/features/shared/activity-background.ts", {
    "../../api": api,
    react: { useState: () => [loaded, value => { loaded = value; }], useEffect: fn => { effect = fn; } },
  }, { Image: class { constructor() { image = {}; return image; } } });
  assert.equal(useBackgroundImage("/activity-a.png"), undefined);
  const cleanup = effect();
  image.onload();
  assert.equal(useBackgroundImage("/activity-a.png"), 'url("/activity-a.png")');
  assert.equal(useBackgroundImage("/activity-b.webp"), undefined);
  cleanup();
  effect();
  image.onerror();
  assert.equal(useBackgroundImage("/activity-b.webp"), undefined);
  assert.equal(useBackgroundImage(null), undefined);
});
