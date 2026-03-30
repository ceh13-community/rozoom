import { describe, expect, it } from "vitest";
import { getGlobalTriageManifest } from "./triage-manifest";

describe("triage manifest", () => {
  it("is registry-driven and covers real resource pages while excluding tool-only panels", () => {
    const manifest = getGlobalTriageManifest();
    const keys = manifest.map((entry) => entry.key);
    const pods = manifest.find((entry) => entry.key === "pods");
    const gateways = manifest.find((entry) => entry.key === "gateways");
    const volumeAttributesClasses = manifest.find(
      (entry) => entry.key === "volumeattributesclasses",
    );

    expect(keys).toContain("pods");
    expect(keys).toContain("nodesstatus");
    expect(keys).toContain("namespaces");
    expect(keys).toContain("configmaps");
    expect(keys).toContain("customresourcedefinitions");
    expect(keys).toContain("storageclasses");
    expect(keys).toContain("gateways");
    expect(keys).toContain("horizontalpodautoscalers");
    expect(keys).toContain("poddisruptionbudgets");
    expect(keys).not.toContain("accessreviews");
    expect(keys).not.toContain("portforwarding");
    expect(pods?.triageMode).toBe("problem_scored");
    expect(pods?.fetchKind).toBe("kubectl_list");
    expect(pods?.optionalFeature).toBe("none");
    expect(gateways?.optionalFeature).toBe("gateway_api");
    expect(volumeAttributesClasses?.optionalFeature).toBe("volume_attributes_class");
  });
});
