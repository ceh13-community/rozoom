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
vi.mock("$features/cluster-manager/api/cloud-import", () => ({
  listCloudClusters: vi.fn(),
  listCloudScopes: vi.fn(async () => ({ scopes: [], label: "Scope" })),
  listCloudClustersAllScopes: vi.fn(async () => ({ clusters: [], errors: [] })),
  importCloudCluster: vi.fn(),
  getSupportedCloudProviders: () => ["AWS EKS"],
  getProviderTool: (provider: string) => (provider === "AWS EKS" ? "aws" : null),
}));
vi.mock("$features/cluster-finder/model/cli-store", () => ({
  detectedCloudConfigs: readable([]),
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
  });

  it("tells the user import is unavailable and hides the search button for AWS EKS", async () => {
    const view = render(ConnectClusterWizard);
    await fireEvent.click(view.getByRole("button", { name: /Cloud Provider/ }));
    expect(await view.findByText(/Cloud import is not available in this build/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "List clusters" })).toBeNull();
    expect(view.queryByRole("button", { name: "Scan all" })).toBeNull();
  });
});
