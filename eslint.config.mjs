import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Generated application bundles, tool caches, and test reports.
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "coverage/**",
    "backend/target/**",
    // Local scratch work, exported evidence, and deployment backups (also Git-ignored).
    "work/**",
    "outputs/**",
    "backups/**",
    // Generated type declarations.
    "next-env.d.ts",
    "types/worker-runtime.d.ts",
    // Next ignores build/ by default, but this project keeps maintained Vite plugin source there.
    "!build/**",
  ]),
]);

export default eslintConfig;
