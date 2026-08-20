import { readdirSync } from "node:fs";
import { join } from "node:path";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

// FSD layer boundaries: a layer may only import from layers below it
// (app > pages > widgets > features > entities > shared), and feature
// slices must not import each other. `$app/*` is left alone because it
// collides with SvelteKit's built-in `$app/navigation` etc.
const fsdForbidden = (...layers) => layers.flatMap((layer) => [`$${layer}`, `$${layer}/**`]);

const fsdLayerBoundary = (files, forbidden, message) => ({
  files,
  rules: {
    "no-restricted-imports": ["error", { patterns: [{ group: forbidden, message }] }],
  },
});

const featureSlices = readdirSync(join(import.meta.dirname, "src/lib/features"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const fsdBoundaries = [
  fsdLayerBoundary(
    ["src/lib/shared/**"],
    fsdForbidden("entities", "features", "widgets", "pages", "processes"),
    "FSD: shared may only import from shared.",
  ),
  fsdLayerBoundary(
    ["src/lib/entities/**"],
    fsdForbidden("features", "widgets", "pages", "processes"),
    "FSD: entities may only import from entities and shared.",
  ),
  fsdLayerBoundary(
    ["src/lib/widgets/**"],
    fsdForbidden("pages", "processes"),
    "FSD: widgets may not import from pages or processes.",
  ),
  ...featureSlices.map((slice) => ({
    files: [`src/lib/features/${slice}/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: fsdForbidden("widgets", "pages", "processes"),
              message: "FSD: features may not import from higher layers or other feature slices.",
            },
            {
              regex: `^\\$features(?!/${slice}(/|$))`,
              message:
                "FSD: features may not import from other feature slices (use relative imports within your own slice).",
            },
          ],
        },
      ],
    },
  })),
  {
    // Legacy FSD violations captured when boundary enforcement was added
    // (2026-08-20). Tech-debt: fix a file, then remove it from this list.
    // Do not add new entries.
    files: [
      "src/lib/features/alerts-hub/model/store.ts",
      "src/lib/features/armor-hub/model/store.ts",
      "src/lib/features/backup-audit/model/store.ts",
      "src/lib/features/capacity-intelligence/model/kubectl-to-capacity.ts",
      "src/lib/features/check-health/api/fleet-heartbeat.ts",
      "src/lib/features/check-health/model/cert-notification-watcher.ts",
      "src/lib/features/check-health/model/stream-watchers/nodes/node-health-updater.ts",
      "src/lib/features/cluster-manager/model/store.ts",
      "src/lib/features/command-palette/model/commands.ts",
      "src/lib/features/compliance-hub/model/store.ts",
      "src/lib/features/fleet-drift/model/compute-drift.ts",
      "src/lib/features/fleet-drift/model/store.ts",
      "src/lib/features/metrics-sources/model/store.ts",
      "src/lib/features/performance-obs/model/fetch-throttling.ts",
      "src/lib/features/pods-workbench/model/incident-timeline.ts",
      "src/lib/features/resource-debug-runtime/model/debug-describe.ts",
      "src/lib/features/resource-debug-runtime/model/pod-debug-session.ts",
      "src/lib/features/section-runtime/model/section-summary.ts",
      "src/lib/features/trivy-hub/model/store.ts",
      "src/lib/features/workloads-management/model/workloads-fetcher.svelte.ts",
      "src/lib/shared/api/cli.ts",
      "src/lib/shared/api/helm.ts",
      "src/lib/shared/api/kubectl-proxy.ts",
      "src/lib/shared/lib/background-pollers.ts",
      "src/lib/shared/lib/cluster-safety.ts",
      "src/lib/shared/lib/guarded-action.ts",
      "src/lib/shared/lib/network-recovery.ts",
      "src/lib/shared/ui/formatters.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/restrict-template-expressions": "off",
      "prettier/prettier": "off",
    },
  },
  {
    ignores: [
      ".eslintignore",
      "build/",
      "src-tauri/",
      ".svelte-kit/",
      "src/shared/ui/data-table/",
      "**/*.test.ts",
      "node_modules",
      "dist",
      "build",
      ".next",
      "coverage",
      "pnpm-lock.yaml",
      "*.config.js",
      "*.config.cjs",
      "playwright.config.ts",
      "playwright.local.config.ts",
      "e2e/",
      "playwright-report/",
    ],
  },
  {
    files: ["**/*.{mjs,js}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  ...fsdBoundaries,
);
