import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Five of the posture score's rules read HPA, VPA, Ingress and RBAC reports that config
// diagnostics leave out, so on the Overview they never ran.
const overview = readFileSync(resolve(__dirname, "overview.svelte"), "utf8");

describe("overview posture checks", () => {
  it("runs the missing posture checks after its diagnostics are stored", () => {
    const diagnostics = overview.indexOf("diagnostics = chain");
    const posture = overview.indexOf(".then(() => loadMissingPostureChecks(clusterId))");
    expect(diagnostics).toBeGreaterThan(-1);
    expect(posture).toBeGreaterThan(diagnostics);
    expect(overview.slice(diagnostics, posture)).toContain("void diagnostics");
  });

  it("asks only for missing or stale reports, at most once per max age", () => {
    const body = overview.slice(overview.indexOf("async function loadMissingPostureChecks"));
    expect(body).toContain("missingPostureChecks(clusterHealth)");
    expect(body).toContain("Date.now() - requestedAt < POSTURE_CHECK_MAX_AGE_MS");
    expect(body).toContain("loadPostureChecks(clusterId, missing)");
  });
});
