import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, extraFileExtensions: [".svelte"] },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      "svelte/no-navigation-without-resolve": "off",
    },
  },
  {
    ignores: ["build/", ".svelte-kit/", "node_modules/", "e2e/", "*.config.*", "*.cjs"],
  },
);
