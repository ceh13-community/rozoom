import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { readable, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectClusterWizard from "./connect-cluster-wizard.svelte";

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
  listCloudScopes: vi.fn(async () => []),
  listCloudClustersAllScopes: vi.fn(async () => ({ clusters: [], errors: [] })),
  importCloudCluster: vi.fn(),
  getSupportedCloudProviders: () => [],
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

const PEM = `-----BEGIN CERTIFICATE-----
MIIBezCCASGgAwIBAgIUAexample
-----END CERTIFICATE-----`;

async function fillTokenForm(caData: string) {
  const view = render(ConnectClusterWizard);
  await fireEvent.click(view.getByRole("button", { name: /Bearer Token/ }));
  const fields: Record<string, string> = {
    "Cluster name *": "prod",
    "API server URL *": "https://api.example.com:6443",
    "Bearer token or ServiceAccount token *": "t0ken",
    "CA certificate data (required for remote clusters)": caData,
  };
  for (const [placeholder, value] of Object.entries(fields)) {
    await fireEvent.input(view.getByPlaceholderText(placeholder), { target: { value } });
  }
  await fireEvent.click(view.getByRole("button", { name: "Connect with token" }));
  return view;
}

describe("connect forms and the CA field", () => {
  beforeEach(() => {
    addClustersFromText.mockClear();
    localStorage.clear();
  });

  it("accepts a pasted PEM and writes it as base64", async () => {
    await fillTokenForm(PEM);
    await waitFor(() => expect(addClustersFromText).toHaveBeenCalledOnce());
    expect(addClustersFromText.mock.calls[0][0]).toContain(
      `certificate-authority-data: ${btoa(PEM)}`,
    );
  });

  it("refuses a CA field that holds no certificate and writes nothing", async () => {
    const view = await fillTokenForm("not a certificate");
    expect(await view.findAllByText(/PEM certificate/)).not.toHaveLength(0);
    expect(addClustersFromText).not.toHaveBeenCalled();
  });
});
