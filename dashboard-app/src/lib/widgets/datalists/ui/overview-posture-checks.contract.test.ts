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

  // A gate inside the component reset on every open of the Overview, so a check that could
  // not read the cluster ran again, and logged again, each time.
  it("asks only for due reports through the module-level gate", () => {
    const body = overview.slice(overview.indexOf("async function loadMissingPostureChecks"));
    expect(body).toContain("takeDuePostureChecks(clusterId, clusterHealth)");
    expect(body).toContain("loadPostureChecks(clusterId, due)");
    expect(overview).not.toMatch(/new (Svelte)?Map<string, number>\(\)/);
  });
});
