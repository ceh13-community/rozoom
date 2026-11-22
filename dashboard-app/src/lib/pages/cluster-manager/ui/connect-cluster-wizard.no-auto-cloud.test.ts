import { fireEvent, render } from "@testing-library/svelte";
import { readable, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectClusterWizard from "./connect-cluster-wizard.svelte";

// The wizard is always mounted on the Cluster Manager. On mount it listed the clusters of
// every detected cloud config (aws configure list-profiles, eks list-clusters per profile)
// and loaded scopes for a saved Cloud Provider method: a cloud CLI ran with the person's
// credentials just by opening the page. No cloud CLI runs without an explicit action.
const { listCloudScopes, listCloudClustersAllScopes } = vi.hoisted(() => ({
  listCloudScopes: vi.fn(async () => ({ scopes: [], label: "Profile" })),
  listCloudClustersAllScopes: vi.fn(async () => ({ clusters: [], errors: [] })),
}));

vi.mock("$features/cluster-manager", () => ({
  addClustersFromText: vi.fn(),
  addClustersFromKubeconfigSelection: vi.fn(),
  clustersList: readable([]),
}));
vi.mock("$features/cluster-manager/api/cloud-import", () => ({
  listCloudClusters: vi.fn(async () => ({ clusters: [] })),
  listCloudScopes,
  listCloudClustersAllScopes,
  importCloudCluster: vi.fn(),
  getSupportedCloudProviders: () => ["AWS EKS"],
  getAvailableCloudProviders: () => ["AWS EKS"],
  getUnbundledCloudTools: () => [],
  getCloudScopeLabel: () => "Profile",
  getProviderTool: () => "aws",
}));
vi.mock("$features/cluster-finder/model/cli-store", () => ({
  detectedCloudConfigs: readable([{ provider: "AWS EKS", label: "AWS", path: "~/.aws/config" }]),
  detectedOsTools: readable([{ tool: "aws", available: true }]),
  loadCloudCliPresence: vi.fn(async () => undefined),
  recheckCloudCliPresence: vi.fn(async () => undefined),
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

describe("cloud CLIs run only on an explicit action", () => {
  beforeEach(() => {
    localStorage.clear();
    listCloudScopes.mockClear();
    listCloudClustersAllScopes.mockClear();
  });

  it("runs nothing on mount, even with aws, a cloud config and a saved Cloud Provider method", async () => {
    localStorage.setItem("connect-cluster:last-method", "cloud");
    const view = render(ConnectClusterWizard);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The saved method is restored: the Cloud Provider form is open.
    expect(view.getByText("Cloud Provider Import")).toBeTruthy();
    expect(listCloudClustersAllScopes).not.toHaveBeenCalled();
    expect(listCloudScopes).not.toHaveBeenCalled();
  });

  it("loads scopes when the scope field is opened and scans clusters on Scan", async () => {
    const view = render(ConnectClusterWizard);
    await fireEvent.click(view.getByRole("button", { name: /Cloud Provider/ }));
    // Picking the method runs nothing.
    expect(listCloudScopes).not.toHaveBeenCalled();
    await fireEvent.focus(view.getByPlaceholderText("profile name"));
    expect(listCloudScopes).toHaveBeenCalledWith("AWS EKS");

    await fireEvent.click(view.getByRole("button", { name: "Scan" }));
    await vi.waitFor(() => expect(listCloudClustersAllScopes).toHaveBeenCalled());
  });
});
