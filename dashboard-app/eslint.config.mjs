import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

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
);
