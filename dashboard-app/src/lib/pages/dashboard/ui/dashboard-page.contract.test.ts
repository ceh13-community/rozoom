import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/dashboard/ui/dashboard-page.svelte"), "utf8");

describe("dashboard page loading contract", () => {
  it("guards cluster-card loading with try/catch/finally", () => {
    expect(source).toContain("try {");
    expect(source).toContain("} catch (error) {");
    expect(source).toContain("} finally {");
    expect(source).toContain('errors = "Failed to load cluster cards."');
    expect(source).toContain("initialLoadComplete = true;");
  });

  it("does not render empty error banner", () => {
    expect(source).toContain("{#if errors}");
    expect(source).toContain("<ErrorMessage error={errors} />");
  });

  it("renders production fleet settings and runtime health panels on the dashboard root", () => {
    expect(source).toContain('import FleetSettingsPanel from "./fleet-settings-panel.svelte"');
    expect(source).toContain('import RuntimeHealthPanel from "./runtime-health-panel.svelte"');
    expect(source).toContain("<FleetSettingsPanel />");
    expect(source).toContain("<RuntimeHealthPanel />");
  });

  it("renders a synthetic-only fleet stress panel when the synthetic harness is active", () => {
    expect(source).toContain(
      'import SyntheticFleetStressPanel from "./synthetic-fleet-stress-panel.svelte"',
    );
    expect(source).toContain("let syntheticFleetSize: number | null = $state(null);");
    expect(source).toContain("syntheticFleetSize = resolvedSyntheticFleetSize;");
    expect(source).toContain(
      "<SyntheticFleetStressPanel fleetSize={syntheticFleetSize} {clusters} />",
    );
  });

  it("stops dashboard background pollers when leaving the cards page", () => {
    expect(source).toContain('import { onDestroy, onMount } from "svelte"');
    expect(source).toContain(
      'import { stopAllBackgroundPollers } from "$shared/lib/background-pollers"',
    );
    expect(source).toContain("onDestroy(() => {");
    expect(source).toContain("stopAllBackgroundPollers();");
  });

  it("supports a dev-only synthetic fleet harness for 50 and 100 card stress runs", () => {
    expect(source).toContain('import { page } from "$app/stores"');
    expect(source).toContain('import { setCache } from "$shared/cache"');
    expect(source).toContain("buildSyntheticFleet");
    expect(source).toContain(
      'resolveSyntheticFleetSize($page.url.searchParams.get("syntheticFleet"))',
    );
    expect(source).toContain('await setCache("health_checks", healthChecks);');
  });
});
