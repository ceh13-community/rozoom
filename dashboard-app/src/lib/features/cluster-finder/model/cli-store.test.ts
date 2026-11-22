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

import {
  detectedOsTools,
  loadCloudCliPresence,
  loadDetectedClis,
  mergeOsTools,
  recheckCloudCliPresence,
} from "./cli-store";

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

  it("recheck: a CLI removed since start is gone, one installed since start is found", async () => {
    const { detectOsToolPresence } = await import("../api/cli-detection");
    await loadCloudCliPresence(["aws", "gcloud"]);
    vi.mocked(detectOsToolPresence).mockImplementationOnce(async (tools) =>
      tools.map((name) => tool(name, name === "gcloud")),
    );
    await recheckCloudCliPresence(["aws", "gcloud"]);
    expect(vi.mocked(detectOsToolPresence)).toHaveBeenLastCalledWith(["aws", "gcloud"]);
    const tools = get(detectedOsTools);
    expect(tools.find((t) => t.tool === "aws")?.available).toBe(false);
    expect(tools.find((t) => t.tool === "gcloud")?.available).toBe(true);
  });

  it("recheck: a tool the probe could not answer for keeps what is known", async () => {
    const { detectOsToolPresence } = await import("../api/cli-detection");
    await loadCloudCliPresence(["aws"]);
    // The probe leaves out a tool whose `which` broke (unknown).
    vi.mocked(detectOsToolPresence).mockResolvedValueOnce([]);
    await recheckCloudCliPresence(["aws"]);
    expect(get(detectedOsTools).find((t) => t.tool === "aws")?.available).toBe(true);
  });

  it("on open, a CLI not found before is looked for again, a found one is not", async () => {
    const { detectOsToolPresence } = await import("../api/cli-detection");
    await loadCloudCliPresence(["aws", "gcloud"]);
    vi.mocked(detectOsToolPresence).mockImplementationOnce(async (tools) =>
      tools.map((name) => tool(name, true)),
    );
    await loadCloudCliPresence(["aws", "gcloud"]);
    expect(vi.mocked(detectOsToolPresence)).toHaveBeenLastCalledWith(["gcloud"]);
    expect(get(detectedOsTools).find((t) => t.tool === "gcloud")?.available).toBe(true);
  });

  it("merge: a newer probe wins for the tools it looked at", () => {
    expect(
      mergeOsTools([tool("aws", true), tool("helm", false)], [tool("helm", true)]).map(
        (t) => `${t.tool}:${t.available}`,
      ),
    ).toEqual(["aws:true", "helm:true"]);
  });
});
