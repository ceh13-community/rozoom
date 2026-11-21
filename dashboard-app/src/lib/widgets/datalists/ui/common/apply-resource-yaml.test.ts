import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectl = vi.hoisted(() => vi.fn());
const fs = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeTextFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: kubectl }));
vi.mock("@tauri-apps/plugin-fs", () => ({ BaseDirectory: { AppData: 1 }, ...fs }));
vi.mock("@tauri-apps/api", () => ({
  path: {
    appDataDir: vi.fn(async () => "/data"),
    join: vi.fn(async (...parts: string[]) => parts.join("/")),
  },
}));

import { applyResourceYaml, buildResourceGetArgs } from "./apply-resource-yaml";

const crd = {
  resource: "customresourcedefinitions",
  name: "widgets.example.com",
  namespaceScoped: false,
};
const yamlAt = (version: string, replicas = 1) =>
  `apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: w\n  resourceVersion: "${version}"\nspec:\n  replicas: ${replicas}\n`;

describe("applyResourceYaml", () => {
  beforeEach(() => {
    kubectl.mockReset();
    Object.values(fs).forEach((fn) => fn.mockClear());
  });

  it("builds get arguments for any kind, cluster or namespace scoped", () => {
    expect(buildResourceGetArgs(crd, "yaml")).toEqual([
      "get",
      "customresourcedefinitions",
      "-o",
      "yaml",
      "--request-timeout=10s",
      "--",
      "widgets.example.com",
    ]);
    expect(
      buildResourceGetArgs(
        { resource: "widgets.example.com", name: "w", namespace: "shop", namespaceScoped: true },
        "yaml",
      ),
    ).toContain("shop");
  });

  it("checks the cluster version, dry-runs on the server, applies and removes the temp file", async () => {
    kubectl.mockResolvedValue({ output: yamlAt("7"), errors: "", code: 0 });
    const result = await applyResourceYaml({
      clusterId: "c1",
      target: crd,
      originalYaml: yamlAt("7"),
      yamlText: yamlAt("7", 3),
    });
    expect(result).toEqual({ status: "applied" });
    const calls = kubectl.mock.calls.map((call) => (call[0] as string[]).slice(0, 2).join(" "));
    expect(calls).toEqual(["get customresourcedefinitions", "apply --dry-run=server", "apply -f"]);
    expect(fs.remove).toHaveBeenCalledOnce();
  });

  it("refuses to apply over a version changed in the cluster", async () => {
    kubectl.mockResolvedValue({ output: yamlAt("8"), errors: "", code: 0 });
    const result = await applyResourceYaml({
      clusterId: "c1",
      target: crd,
      originalYaml: yamlAt("7"),
      yamlText: yamlAt("7", 3),
    });
    expect(result.status).toBe("drift");
    expect(kubectl).toHaveBeenCalledTimes(1);
  });

  it("reports invalid YAML without calling the cluster", async () => {
    const result = await applyResourceYaml({
      clusterId: "c1",
      target: crd,
      originalYaml: "",
      yamlText: "spec: [unclosed",
    });
    expect(result.status).toBe("invalid");
    expect(kubectl).not.toHaveBeenCalled();
  });

  it("returns the dry-run error and does not apply", async () => {
    kubectl
      .mockResolvedValueOnce({ output: yamlAt("7"), errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "", errors: "spec.replicas: Invalid value", code: 1 });
    const result = await applyResourceYaml({
      clusterId: "c1",
      target: crd,
      originalYaml: yamlAt("7"),
      yamlText: yamlAt("7", -1),
    });
    expect(result.status).toBe("failed");
    expect(kubectl).toHaveBeenCalledTimes(2);
    expect(fs.remove).toHaveBeenCalledOnce();
  });
});
