import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listCloudClusters,
  importCloudCluster,
  getSupportedCloudProviders,
  parseAwsEksList,
  parseAwsRegions,
  parseGkeList,
  parseAksList,
  parseDoksList,
  type CloudCluster,
} from "./cloud-import";

// ---------------------------------------------------------------------------
// Mock CLI layer
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();

vi.mock("$shared/api/cli", () => ({
  createCliCommand: vi
    .fn()
    .mockImplementation((_tool: string, _args: string[]) =>
      Promise.resolve({ execute: () => mockExecute() }),
    ),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/test-app-data"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue("apiVersion: v1\nclusters:\n  - name: from-file"),
  remove: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockExecute.mockReset();
});

// ---------------------------------------------------------------------------
// getSupportedCloudProviders
// ---------------------------------------------------------------------------

describe("getSupportedCloudProviders", () => {
  it("includes AWS EKS, GKE, AKS, DigitalOcean", () => {
    const providers = getSupportedCloudProviders();
    expect(providers).toContain("AWS EKS");
    expect(providers).toContain("GKE");
    expect(providers).toContain("AKS");
    expect(providers).toContain("DigitalOcean");
    expect(providers.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Parse helpers (pure functions - no mocks needed)
// ---------------------------------------------------------------------------

describe("parseAwsRegions", () => {
  it("extracts region names from describe-regions output", () => {
    const stdout = JSON.stringify({
      Regions: [
        { RegionName: "us-east-1" },
        { RegionName: "eu-west-1" },
        { RegionName: "ap-southeast-1" },
      ],
    });
    expect(parseAwsRegions(stdout)).toEqual(["ap-southeast-1", "eu-west-1", "us-east-1"]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseAwsRegions("not json")).toEqual([]);
  });

  it("skips entries without RegionName", () => {
    const stdout = JSON.stringify({ Regions: [{ RegionName: "us-east-1" }, {}] });
    expect(parseAwsRegions(stdout)).toEqual(["us-east-1"]);
  });

  it("returns empty array when Regions key is missing", () => {
    expect(parseAwsRegions("{}")).toEqual([]);
  });
});

describe("parseAwsEksList", () => {
  it("maps cluster names with region", () => {
    const stdout = JSON.stringify({ clusters: ["prod", "staging"] });
    const result = parseAwsEksList(stdout, "us-east-1");
    expect(result).toEqual([
      { name: "prod", region: "us-east-1", provider: "AWS EKS" },
      { name: "staging", region: "us-east-1", provider: "AWS EKS" },
    ]);
  });

  it("returns empty for empty clusters array", () => {
    expect(parseAwsEksList(JSON.stringify({ clusters: [] }), "us-east-1")).toEqual([]);
  });

  it("returns empty for malformed JSON", () => {
    expect(parseAwsEksList("{broken", "us-east-1")).toEqual([]);
  });
});

describe("parseGkeList", () => {
  it("prefers location over zone", () => {
    const stdout = JSON.stringify([
      { name: "gke-prod", zone: "us-central1-a", location: "us-central1" },
    ]);
    const result = parseGkeList(stdout);
    expect(result).toEqual([{ name: "gke-prod", region: "us-central1", provider: "GKE" }]);
  });

  it("falls back to zone when location is absent", () => {
    const stdout = JSON.stringify([{ name: "gke-zonal", zone: "europe-west1-b" }]);
    expect(parseGkeList(stdout)[0].region).toBe("europe-west1-b");
  });

  it("returns empty for malformed JSON", () => {
    expect(parseGkeList("///")).toEqual([]);
  });
});

describe("parseAksList", () => {
  it("includes resourceGroup in result", () => {
    const stdout = JSON.stringify([
      { name: "aks-prod", location: "westeurope", resourceGroup: "rg-prod" },
    ]);
    const result = parseAksList(stdout);
    expect(result).toEqual([
      {
        name: "aks-prod",
        region: "westeurope",
        provider: "AKS",
        resourceGroup: "rg-prod",
      },
    ]);
  });

  it("handles multiple clusters across resource groups", () => {
    const stdout = JSON.stringify([
      { name: "aks-a", location: "westeurope", resourceGroup: "rg-1" },
      { name: "aks-b", location: "eastus", resourceGroup: "rg-2" },
    ]);
    const result = parseAksList(stdout);
    expect(result).toHaveLength(2);
    expect(result[0].resourceGroup).toBe("rg-1");
    expect(result[1].resourceGroup).toBe("rg-2");
  });

  it("returns empty for malformed JSON", () => {
    expect(parseAksList("bad")).toEqual([]);
  });
});

describe("parseDoksList", () => {
  it("parses doctl kubernetes cluster list output", () => {
    const stdout = JSON.stringify([
      { id: "abc-123", name: "do-prod", region_slug: "nyc1" },
      { id: "def-456", name: "do-staging", region_slug: "ams3" },
    ]);
    const result = parseDoksList(stdout);
    expect(result).toEqual([
      { name: "do-prod", region: "nyc1", provider: "DigitalOcean" },
      { name: "do-staging", region: "ams3", provider: "DigitalOcean" },
    ]);
  });

  it("falls back to region when region_slug is absent", () => {
    const stdout = JSON.stringify([{ name: "cluster-1", region: "fra1" }]);
    expect(parseDoksList(stdout)[0].region).toBe("fra1");
  });

  it("uses unknown when no region info exists", () => {
    const stdout = JSON.stringify([{ name: "cluster-x" }]);
    expect(parseDoksList(stdout)[0].region).toBe("unknown");
  });

  it("returns empty for malformed JSON", () => {
    expect(parseDoksList("nope")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listCloudClusters (integration with mock CLI)
// ---------------------------------------------------------------------------

describe("listCloudClusters", () => {
  it("parses AWS EKS single-region cluster list", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ clusters: ["prod-cluster", "staging-cluster"] }),
      stderr: "",
    });

    const result = await listCloudClusters("AWS EKS", "us-east-1");

    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]).toEqual({
      name: "prod-cluster",
      region: "us-east-1",
      provider: "AWS EKS",
    });
  });

  it("discovers AWS EKS clusters cross-region when no region is given", async () => {
    // First call: describe-regions
    mockExecute.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify(["us-east-1", "eu-west-1"]),
      stderr: "",
    });
    // Parallel calls: list-clusters per region (order not guaranteed)
    // Use a common response containing one cluster; region is injected by parseList
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ clusters: ["my-cluster"] }),
      stderr: "",
    });

    const result = await listCloudClusters("AWS EKS");

    expect(result.error).toBeUndefined();
    expect(result.clusters).toHaveLength(2);
    const regions = result.clusters.map((c) => c.region).sort();
    expect(regions).toEqual(["eu-west-1", "us-east-1"]);
    expect(result.clusters.every((c) => c.name === "my-cluster")).toBe(true);
    expect(result.clusters.every((c) => c.provider === "AWS EKS")).toBe(true);
  });

  it("returns error when cross-region region discovery fails", async () => {
    mockExecute.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "ExpiredTokenException",
    });

    const result = await listCloudClusters("AWS EKS");

    expect(result.clusters).toHaveLength(0);
    expect(result.error).toContain("Failed to list regions");
  });

  it("skips regions that fail during cross-region scan", async () => {
    mockExecute.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify(["us-east-1"]),
      stderr: "",
    });
    // Single region fails
    mockExecute.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "AccessDenied",
    });

    const result = await listCloudClusters("AWS EKS");

    expect(result.clusters).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  it("parses GKE cluster list", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        { name: "gke-prod", zone: "us-central1-a", location: "us-central1" },
      ]),
      stderr: "",
    });

    const result = await listCloudClusters("GKE");

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toEqual({
      name: "gke-prod",
      region: "us-central1",
      provider: "GKE",
    });
  });

  it("parses AKS cluster list with resourceGroup", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        { name: "aks-prod", location: "westeurope", resourceGroup: "rg-prod" },
      ]),
      stderr: "",
    });

    const result = await listCloudClusters("AKS");

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toEqual({
      name: "aks-prod",
      region: "westeurope",
      provider: "AKS",
      resourceGroup: "rg-prod",
    });
  });

  it("parses DigitalOcean DOKS cluster list", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ id: "abc", name: "do-prod", region_slug: "nyc1" }]),
      stderr: "",
    });

    const result = await listCloudClusters("DigitalOcean");

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toEqual({
      name: "do-prod",
      region: "nyc1",
      provider: "DigitalOcean",
    });
  });

  it("returns error for unsupported provider", async () => {
    const result = await listCloudClusters("Oracle OKE");
    expect(result.clusters).toHaveLength(0);
    expect(result.error).toContain("Unsupported");
  });

  it("returns error on CLI failure", async () => {
    mockExecute.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "ExpiredTokenException",
    });

    const result = await listCloudClusters("AWS EKS", "us-east-1");
    expect(result.clusters).toHaveLength(0);
    expect(result.error).toContain("ExpiredToken");
  });
});

// ---------------------------------------------------------------------------
// importCloudCluster
// ---------------------------------------------------------------------------

describe("importCloudCluster", () => {
  it("returns success with kubeconfig for AWS EKS", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: "Added new context",
      stderr: "",
    });

    const cluster: CloudCluster = {
      name: "prod-cluster",
      region: "us-east-1",
      provider: "AWS EKS",
    };
    const result = await importCloudCluster(cluster);

    expect(result.success).toBe(true);
    // kubeconfig is read from temp file, not stdout
    expect(result.kubeconfigYaml).toContain("apiVersion");
  });

  it("passes resourceGroup for AKS import", async () => {
    const { createCliCommand } = await import("$shared/api/cli");
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });

    const cluster: CloudCluster = {
      name: "aks-prod",
      region: "westeurope",
      provider: "AKS",
      resourceGroup: "rg-prod",
    };
    const result = await importCloudCluster(cluster);

    expect(createCliCommand).toHaveBeenCalledWith(
      "az",
      expect.arrayContaining(["--resource-group", "rg-prod", "--file"]),
    );
    expect(result.success).toBe(true);
  });

  it("returns success with kubeconfig for DigitalOcean", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: "apiVersion: v1\nclusters:\n  - name: do-prod",
      stderr: "",
    });

    const cluster: CloudCluster = { name: "do-prod", region: "nyc1", provider: "DigitalOcean" };
    const result = await importCloudCluster(cluster);

    expect(result.success).toBe(true);
    expect(result.kubeconfigYaml).toContain("apiVersion");
  });

  it("returns error on import failure", async () => {
    mockExecute.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "ResourceNotFoundException",
    });

    const cluster: CloudCluster = { name: "nonexistent", region: "us-east-1", provider: "AWS EKS" };
    const result = await importCloudCluster(cluster);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ResourceNotFoundException");
  });

  it("returns error for unsupported provider", async () => {
    const cluster = { name: "cluster", region: "region", provider: "Unknown" } as CloudCluster;
    const result = await importCloudCluster(cluster);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported");
  });
});
