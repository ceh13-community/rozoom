import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import process from "process";

const dev = process.env.NODE_ENV === "development";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Inline each component's CSS into its compiled JS and inject at runtime
    // via document.head.appendChild, instead of emitting a separate virtual
    // `?svelte&type=style&lang.css` URL. This eliminates a long-standing
    // race between the WebKitGTK cache and the Svelte Vite plugin on HMR
    // reloads (documented in README.md > Troubleshooting dev builds), where
    // the browser requested the style URL before the parent .svelte file
    // finished transforming and Vite served the raw source to PostCSS.
    //
    // For a Tauri desktop app with adapter-static and local assets the
    // tradeoffs favour `injected`: no network caching benefit is lost,
    // there is no FOUC because JS loads before first paint, and the dev
    // experience becomes deterministic.
    css: "injected",
  },
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
