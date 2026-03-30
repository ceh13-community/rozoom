import { defineConfig, devices } from "@playwright/test";

// Playwright sets FORCE_COLOR in this environment; drop NO_COLOR to avoid noisy child-process warnings.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  webServer: {
    command:
      "VITE_ENABLE_SYNTHETIC_FLEET_HARNESS=true pnpm build && VITE_ENABLE_SYNTHETIC_FLEET_HARNESS=true pnpm preview --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
