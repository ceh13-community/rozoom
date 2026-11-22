import { fireEvent, render, screen } from "@testing-library/svelte";
import { readable, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectedCloudConfigs, detectedOsTools } from "$features/cluster-finder/model/cli-store";
import ConnectClusterWizard from "./connect-cluster-wizard.svelte";

// Which cloud CLIs are installed was checked once, at start: an aws removed later stayed
// offered and failed on Scan, one installed later stayed hidden until a restart. Scan looks
// again with `which`. The real CLI store runs here; only `which` is faked.
const { installed, listCloudClusters, listCloudClustersAllScopes } = vi.hoisted(() => ({
  installed: new Set<string>(),
  listCloudClusters: vi.fn(async () => ({ clusters: [] })),
  listCloudClustersAllScopes: vi.fn(async () => ({ clusters: [], errors: [] })),
}));

vi.mock("$features/cluster-finder/api/cli-detection", () => ({
  detectAvailableClis: vi.fn(async () => []),
  detectOsTools: vi.fn(async () => []),
  detectCloudConfigs: vi.fn(async () => []),
  detectOsToolPresence: vi.fn(async (tools: string[]) =>
    tools.map((tool) => ({
      tool,
      provider: null,
      available: installed.has(tool),
      path: installed.has(tool) ? `/usr/bin/${tool}` : null,
      version: null,
    })),
  ),
}));
vi.mock("$features/cluster-manager/api/cloud-import", () => ({
  listCloudClusters,
  listCloudScopes: vi.fn(async () => ({
    scopes: [{ id: "default", label: "default" }],
    label: "Profile",
  })),
  listCloudClustersAllScopes,
  importCloudCluster: vi.fn(),
  getSupportedCloudProviders: () => ["AWS EKS"],
  getAvailableCloudProviders: (tools: Array<{ tool: string; available: boolean }>) =>
    tools.some((t) => t.tool === "aws" && t.available) ? ["AWS EKS"] : [],
  getUnbundledCloudTools: () => ["aws"],
  getCloudScopeLabel: () => "Profile",
  getProviderTool: () => "aws",
}));
vi.mock("$features/cluster-manager", () => ({
  addClustersFromText: vi.fn(),
  addClustersFromKubeconfigSelection: vi.fn(),
  clustersList: readable([]),
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

const cloudMethod = () => screen.queryByRole("button", { name: /Cloud Provider/ });

describe("Scan checks again which cloud CLIs are installed", () => {
  beforeEach(() => {
    localStorage.clear();
    installed.clear();
    detectedOsTools.set([]);
    detectedCloudConfigs.set([]);
    listCloudClusters.mockClear();
    listCloudClustersAllScopes.mockClear();
  });

  it("an aws removed since start is not run on Scan all; the form asks to install it", async () => {
    installed.add("aws");
    const view = render(ConnectClusterWizard);
    await vi.waitFor(() => expect(cloudMethod()).toBeTruthy());
    await fireEvent.click(cloudMethod()!);
    // Profiles load while aws is still there, so Scan all is offered.
    await fireEvent.focus(view.getByPlaceholderText("profile name"));
    await vi.waitFor(() => expect(view.getByRole("button", { name: "Scan all" })).toBeTruthy());

    installed.delete("aws");
    await fireEvent.click(view.getByRole("button", { name: "Scan all" }));
    await vi.waitFor(() =>
      expect(view.getByText(/aws is no longer found on this machine/)).toBeTruthy(),
    );
    expect(listCloudClustersAllScopes).not.toHaveBeenCalled();
    expect(view.getByText("Install the aws CLI to import from AWS EKS.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "List clusters" })).toBeNull();
  });

  it("an aws removed since start is not run on List clusters", async () => {
    installed.add("aws");
    const view = render(ConnectClusterWizard);
    await vi.waitFor(() => expect(cloudMethod()).toBeTruthy());
    await fireEvent.click(cloudMethod()!);

    installed.delete("aws");
    await fireEvent.click(view.getByRole("button", { name: "List clusters" }));
    await vi.waitFor(() =>
      expect(view.getByText(/aws is no longer found on this machine/)).toBeTruthy(),
    );
    expect(listCloudClusters).not.toHaveBeenCalled();
  });

  it("an aws installed since start is found on Scan, no restart", async () => {
    detectedCloudConfigs.set([
      { provider: "AWS EKS", label: "AWS", configPath: "~/.aws/config", found: true },
    ]);
    const view = render(ConnectClusterWizard);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cloudMethod()).toBeNull();

    installed.add("aws");
    await fireEvent.click(view.getByRole("button", { name: "Scan" }));

    await vi.waitFor(() => expect(listCloudClustersAllScopes).toHaveBeenCalledWith("AWS EKS"));
    expect(cloudMethod()).toBeTruthy();
  });
});
