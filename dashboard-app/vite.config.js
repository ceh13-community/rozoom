import { defineConfig, loadEnv } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import devtoolsJson from "vite-plugin-devtools-json";
import { sentrySvelteKit } from "@sentry/sveltekit";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import process from "process";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sentryOrg = env.SENTRY_ORG?.trim() || "";
  const sentryProject = env.SENTRY_PROJECT?.trim() || "";
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN?.trim();
  const enableSentrySourceMapUpload =
    !process.env.VITEST &&
    env.SENTRY_ENABLE_SOURCE_MAP_UPLOAD === "true" &&
    Boolean(sentryAuthToken);

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      enableSentrySourceMapUpload
        ? sentrySvelteKit({
            sourceMapsUploadOptions: {
              authToken: sentryAuthToken,
              org: sentryOrg,
              project: sentryProject,
            },
          })
        : null,
      sveltekit(),
      svelteTesting(),
      devtoolsJson(),
    ].filter(Boolean),
    clearScreen: false,
    server: {
      deps: {
        inline: ["lodash"],
      },
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**", "**/.pnpm-store/**"],
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/setupTests.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/cypress/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,playwright}.config.*",
        "e2e/**",
        "**/*.e2e.*",
        "**/*.pw.*",
        "**/playwright/**",
      ],
      alias: {
        "@sentry/sveltekit": fileURLToPath(
          new URL("./src/test/mocks/sentry-sveltekit.ts", import.meta.url),
        ),
      },
    },
    build: {
      rollupOptions: {
        output: {
          /** @param {string} id */
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@tanstack/table-core")) return "vendor-table";
            if (id.includes("lodash")) return "vendor-lodash";
            if (id.includes("js-yaml")) return "vendor-yaml";
            if (id.includes("@kubernetes/")) return "vendor-k8s";
            if (id.includes("@lucide/")) return "vendor-icons";
            return "vendor";
          },
        },
      },
    },
  };
});
