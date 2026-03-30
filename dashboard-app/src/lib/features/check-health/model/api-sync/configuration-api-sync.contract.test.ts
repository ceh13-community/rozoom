import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("configuration api sync contract", () => {
  it("routes configuration sync through shared api sync with legacy fallback", () => {
    const source = readFileSync(
      resolve(
        "src/lib/features/check-health/model/stream-watchers/configuration/configuration-sync.ts",
      ),
      "utf8",
    );

    expect(source).toContain("createApiResourceSync");
    expect(source).toContain("getPaths: () => getConfigurationApiPaths(workloadType)");
    expect(source).toContain("fallbackStart: (clusterId) => {");
    expect(source).toContain("startConfigurationWatcher(clusterId, workloadType);");
    expect(source).toContain("fallbackStop: (clusterId) => {");
    expect(source).toContain("stopConfigurationWatcher(clusterId, workloadType);");
  });
});
