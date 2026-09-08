import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Execute the real TS modules without introducing another bundler or test runtime.
export function loadModule(path, mocks = {}, globals = {}) {
  const filename = resolve(root, path);
  const require = createRequire(filename);
  const loadedModule = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  runInNewContext(outputText, {
    module: loadedModule, exports: loadedModule.exports, ...globals,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith(".")) {
        const base = resolve(dirname(filename), id);
        const local = [base + ".ts", base + ".tsx"].find(existsSync);
        if (local) return loadModule(local, mocks, globals);
      }
      return require(id);
    },
  }, { filename });
  return loadedModule.exports;
}
