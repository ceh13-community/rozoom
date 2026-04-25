import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/datalists/ui/overview.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/model/overview-runtime.ts"),
  "utf8",
);

describe("overview loading safety contract", () => {
  it("uses timeout guards for health-adjacent overview fetches", () => {
    expect(source).toContain("const EVENTS_TIMEOUT_MS = 15_000");
    expect(source).toContain("const CERTIFICATES_TIMEOUT_MS = 20_000");
    expect(source).toContain("const CERTIFICATES_RETRY_TIMEOUT_MS = 35_000");
    expect(source).toContain("const USAGE_METRICS_TIMEOUT_MS = 12_000");
    expect(source).toContain("const CERTIFICATES_RETRY_BACKOFF_MS = [750, 1_500]");
    expect(source).toContain("withTimeout(");
    expect(runtimeSource).toContain("const timeoutId = setTimeout(() => {");
    expect(runtimeSource).toContain("clearTimeout(timeoutId);");
    expect(source).toContain('"Usage metrics"');
  });

  it("has watchdog fallback that always clears stuck loading state", () => {
    expect(source).toContain("eventsWatchdog = setTimeout(() => {");
    expect(source).toContain("eventsInFlight = false;");
    expect(source).toContain("eventsLoading = false;");
    expect(source).toContain("certificatesWatchdog = setTimeout(");
    expect(source).toContain("certificatesInFlight = false;");
    expect(source).toContain("certificatesLoading = false;");
    expect(source).toContain("isCertificatesRetryableError(error)");
    expect(source).toContain("await sleep(CERTIFICATES_RETRY_BACKOFF_MS[attempt] ?? 0);");
  });
});
