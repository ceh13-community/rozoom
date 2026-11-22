import { fireEvent, render } from "@testing-library/svelte";
import { readable, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectClusterWizard from "./connect-cluster-wizard.svelte";

vi.hoisted(() => {
  vi.stubEnv("VITE_ROZOOM_TOOLS", "kubectl,helm");
});

const { addClustersFromText } = vi.hoisted(() => ({
  addClustersFromText: vi.fn(async (_yaml: string) => undefined),
}));

vi.mock("$features/cluster-manager", () => ({
  addClustersFromText,
  addClustersFromKubeconfigSelection: vi.fn(),
  clustersList: readable([]),
}));
// The slim build bundles no cloud CLI: what the OS probe finds decides what is offered.
const { osTools } = vi.hoisted(() => ({
  osTools: { value: [] as Array<{ tool: string; available: boolean }> },
}));
vi.mock("$features/cluster-manager/api/cloud-import", () => ({
  listCloudClusters: vi.fn(),
  listCloudScopes: vi.fn(async () => ({ scopes: [], label: "Scope" })),
  listCloudClustersAllScopes: vi.fn(async () => ({ clusters: [], errors: [] })),
  importCloudCluster: vi.fn(),
  getSupportedCloudProviders: () => ["AWS EKS", "GKE"],
  getAvailableCloudProviders: (tools: Array<{ tool: string; available: boolean }>) =>
    [
      ["AWS EKS", "aws"],
      ["GKE", "gcloud"],
    ]
      .filter(([, tool]) => tools.some((t) => t.tool === tool && t.available))
      .map(([provider]) => provider),
  getProviderTool: (provider: string) =>
    provider === "AWS EKS" ? "aws" : provider === "GKE" ? "gcloud" : null,
}));
vi.mock("$features/cluster-finder/model/cli-store", () => ({
  detectedCloudConfigs: readable([]),
  get detectedOsTools() {
    return readable(osTools.value);
  },
}));
vi.mock("$features/cluster-finder", () => ({
  getLocalScanConsent: () => "denied",
  setLocalScanConsent: vi.fn(),
  LOCAL_SCAN_PRIVACY_NOTE: "",
  localScanClusters: writable([]),
  localScanConfig: writable(null),
  isLocalScanning: writable(false),
  localScanned: writable(false),
  localScanError: writable(null),
  runLocalDiscoveryScan: vi.fn(),
  clearLocalScan: vi.fn(),
}));
vi.mock("$features/cluster-manager/api/test-connection", () => ({ testKubeconfig: vi.fn() }));

describe("cloud import on a slim build", () => {
  beforeEach(() => {
    localStorage.clear();
    osTools.value = [];
  });

  it("offers no Cloud Provider method when no cloud CLI is installed", () => {
    const view = render(ConnectClusterWizard);
    expect(view.queryByRole("button", { name: /Cloud Provider/ })).toBeNull();
  });

  it("offers only the provider whose CLI is installed, ready to list", async () => {
    osTools.value = [
      { tool: "aws", available: false },
      { tool: "gcloud", available: true },
    ];
    const view = render(ConnectClusterWizard);
    await fireEvent.click(view.getByRole("button", { name: /Cloud Provider/ }));
    const options = [...view.container.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("GKE");
    expect(options).not.toContain("AWS EKS");
    expect(view.queryByText(/not available in this build/)).toBeNull();
  });
});
