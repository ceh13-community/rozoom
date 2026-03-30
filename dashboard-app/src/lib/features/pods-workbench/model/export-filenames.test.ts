import { describe, expect, it } from "vitest";
import { buildIncidentFilename, buildYamlFilename } from "./export-filenames";

describe("buildIncidentFilename", () => {
  it("builds markdown filename with normalized timestamp", () => {
    const date = new Date("2026-02-14T15:31:22.123Z");
    expect(buildIncidentFilename("argocd", "appset", date)).toBe(
      "pod-incident-argocd-appset-2026-02-14T15-31-22-123Z.md",
    );
  });
});

describe("buildYamlFilename", () => {
  it("builds yaml filename with normalized timestamp", () => {
    const date = new Date("2026-02-14T15:31:22.123Z");
    expect(buildYamlFilename("deployment", "kube-system", "dns", date)).toBe(
      "deployment-kube-system-dns-2026-02-14T15-31-22-123Z.yaml",
    );
  });
});
