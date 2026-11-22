import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tool = (name: string, available: boolean) => ({
  tool: name,
  provider: null,
  available,
  path: available ? `/usr/bin/${name}` : null,
  version: null,
});

vi.mock("../api/cli-detection", () => ({
  detectAvailableClis: vi.fn(async () => []),
  // The slim build probes only the tools it enables.
  detectOsTools: vi.fn(async () => [tool("kubectl", true), tool("helm", true)]),
  detectCloudConfigs: vi.fn(async () => []),
  detectOsToolPresence: vi.fn(async (tools: string[]) =>
    tools.map((name) => tool(name, name === "aws")),
  ),
}));

import { detectedOsTools, loadCloudCliPresence, loadDetectedClis, mergeOsTools } from "./cli-store";

// On slim the full scan probes kubectl and helm only and replaced the store: the aws found
// by the presence check was dropped and Cloud Provider disappeared after Scan.
describe("detected OS tools", () => {
  beforeEach(() => {
    detectedOsTools.set([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
  });

  it("keep the installed cloud CLIs after the full scan", async () => {
    await loadCloudCliPresence(["aws", "gcloud"]);
    await loadDetectedClis();
    const tools = get(detectedOsTools);
    expect(tools.find((t) => t.tool === "aws")?.available).toBe(true);
    expect(tools.map((t) => t.tool).sort()).toEqual(["aws", "gcloud", "helm", "kubectl"]);
  });

  it("probe only cloud CLIs that are not known yet", async () => {
    const { detectOsToolPresence } = await import("../api/cli-detection");
    await loadDetectedClis();
    await loadCloudCliPresence(["aws", "kubectl"]);
    expect(vi.mocked(detectOsToolPresence)).toHaveBeenLastCalledWith(["aws"]);
  });

  it("merge: a newer probe wins for the tools it looked at", () => {
    expect(
      mergeOsTools([tool("aws", true), tool("helm", false)], [tool("helm", true)]).map(
        (t) => `${t.tool}:${t.available}`,
      ),
    ).toEqual(["aws:true", "helm:true"]);
  });
});
