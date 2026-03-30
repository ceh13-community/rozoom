import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import process from "process";

const dev = process.env.NODE_ENV === "development";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: dev
      ? undefined
      : adapter({
          pages: "build",
          assets: "build",
          fallback: "index.html",
        }),
    paths: {
      base: "",
    },
    alias: {
      "@/*": "./src/*",
      $app: "./src/lib/app",
      "$app/*": "./src/lib/app/*",
      $processes: "./src/lib/processes",
      "$processes/*": "./src/lib/processes/*",
      $pages: "./src/lib/pages",
      "$pages/*": "./src/lib/pages/*",
      $widgets: "./src/lib/widgets",
      "$widgets/*": "./src/lib/widgets/*",
      $features: "./src/lib/features",
      "$features/*": "./src/lib/features/*",
      $entities: "./src/lib/entities",
      "$entities/*": "./src/lib/entities/*",
      $shared: "./src/lib/shared",
      "$shared/*": "./src/lib/shared/*",
    },
  },
};

export default config;
