import { describe, expect, it } from "vitest";
import { buildDriftMessage, checkYamlDrift } from "./drift-guard";

const BASE_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "100"
spec: {}
`;

describe("checkYamlDrift", () => {
  it("detects drift when resourceVersion changed", () => {
    const currentYaml = BASE_YAML.replace('"100"', '"101"');
    const result = checkYamlDrift(BASE_YAML, currentYaml);
    expect(result.hasDrift).toBe(true);
    expect(result.originalResourceVersion).toBe("100");
    expect(result.currentResourceVersion).toBe("101");
  });

  it("does not report drift when resourceVersion is unchanged", () => {
    const result = checkYamlDrift(BASE_YAML, BASE_YAML);
    expect(result.hasDrift).toBe(false);
  });

  it("does not report drift when resourceVersion is missing", () => {
    const noRvYaml = BASE_YAML.replace(/resourceVersion: "100"/, "");
    const result = checkYamlDrift(noRvYaml, BASE_YAML);
    expect(result.hasDrift).toBe(false);
    expect(result.originalResourceVersion).toBeNull();
  });
});

describe("buildDriftMessage", () => {
  it("returns null when no drift", () => {
    expect(
      buildDriftMessage({
        hasDrift: false,
        originalResourceVersion: "100",
        currentResourceVersion: "100",
      }),
    ).toBeNull();
  });

  it("returns readable drift message", () => {
    const message = buildDriftMessage({
      hasDrift: true,
      originalResourceVersion: "100",
      currentResourceVersion: "101",
    });
    expect(message).toContain("rv 100 -> 101");
  });
});
