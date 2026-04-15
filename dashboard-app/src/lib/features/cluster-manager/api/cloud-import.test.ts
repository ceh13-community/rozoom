import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listCloudClusters,
  listCloudScopes,
  listCloudClustersAllScopes,
  importCloudCluster,
  getSupportedCloudProviders,
  parseAwsEksList,
  parseAwsRegions,
  parseAwsProfiles,
  parseGkeList,
  parseGcpProjects,
  parseAksList,
  parseAzureSubscriptions,
  parseDoksList,
  type CloudCluster,
} from "./cloud-import";

// ---------------------------------------------------------------------------
// Mock CLI layer
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
const mockExecuteByArgs = vi.fn<(tool: string, args: string[]) => unknown>();

vi.mock("$shared/api/cli", () => ({
  createCliCommand: vi.fn().mockImplementation((tool: string, args: string[]) =>
    Promise.resolve({
      execute: () => {
        const routed = mockExecuteByArgs(tool, args);
        if (routed !== undefined) return Promise.resolve(routed);
        return mockExecute();
      },
    }),
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
  mockExecuteByArgs.mockReset();
  mockExecuteByArgs.mockReturnValue(undefined);
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

describe("parseAwsProfiles", () => {
  it("parses one profile per line", () => {
    expect(parseAwsProfiles("default\nprod\nstaging\n")).toEqual([
      { id: "default", label: "default" },
      { id: "prod", label: "prod" },
      { id: "staging", label: "staging" },
    ]);
  });

  it("trims whitespace and skips empty lines", () => {
    expect(parseAwsProfiles("  default  \n\n  prod  \n")).toEqual([
      { id: "default", label: "default" },
      { id: "prod", label: "prod" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseAwsProfiles("")).toEqual([]);
  });
});

describe("parseGcpProjects", () => {
  it("extracts projectId from projects list", () => {
    const stdout = JSON.stringify([
      { projectId: "prod-project", name: "Production" },
      { projectId: "dev-project", name: "Development" },
    ]);
    expect(parseGcpProjects(stdout)).toEqual([
      { id: "prod-project", label: "prod-project" },
      { id: "dev-project", label: "dev-project" },
    ]);
  });

  it("skips entries without projectId", () => {
    const stdout = JSON.stringify([{ projectId: "p1" }, { name: "no-id" }]);
    expect(parseGcpProjects(stdout)).toEqual([{ id: "p1", label: "p1" }]);
  });

  it("returns empty for malformed JSON", () => {
    expect(parseGcpProjects("{invalid")).toEqual([]);
  });
});

describe("parseAzureSubscriptions", () => {
  it("includes subscription name in label when available", () => {
    const stdout = JSON.stringify([
      { id: "sub-1-id", name: "Prod Sub" },
      { id: "sub-2-id", name: "Dev Sub" },
    ]);
    expect(parseAzureSubscriptions(stdout)).toEqual([
      { id: "sub-1-id", label: "Prod Sub (sub-1-id)" },
      { id: "sub-2-id", label: "Dev Sub (sub-2-id)" },
    ]);
  });

  it("falls back to id when name is missing", () => {
    const stdout = JSON.stringify([{ id: "sub-id-only" }]);
    expect(parseAzureSubscriptions(stdout)).toEqual([{ id: "sub-id-only", label: "sub-id-only" }]);
  });

  it("skips entries without id", () => {
    const stdout = JSON.stringify([{ id: "keep" }, { name: "no-id" }]);
    expect(parseAzureSubscriptions(stdout)).toEqual([{ id: "keep", label: "keep" }]);
  });

  it("returns empty for malformed JSON", () => {
    expect(parseAzureSubscriptions("bad")).toEqual([]);
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

  it("passes AWS profile as --profile when scope is provided", async () => {
    const { createCliCommand } = await import("$shared/api/cli");
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ clusters: ["cluster-a"] }),
      stderr: "",
    });

    const result = await listCloudClusters("AWS EKS", "us-east-1", "prod-profile");

    expect(createCliCommand).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["--profile", "prod-profile"]),
    );
    expect(result.clusters[0].scope).toBe("prod-profile");
  });

  it("passes GCP project as --project when scope is provided", async () => {
    const { createCliCommand } = await import("$shared/api/cli");
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ name: "gke-a", location: "us-central1" }]),
      stderr: "",
    });

    const result = await listCloudClusters("GKE", undefined, "my-project");

    expect(createCliCommand).toHaveBeenCalledWith(
      "gcloud",
      expect.arrayContaining(["--project=my-project"]),
    );
    expect(result.clusters[0].scope).toBe("my-project");
  });

  it("passes Azure subscription when scope is provided", async () => {
    const { createCliCommand } = await import("$shared/api/cli");
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ name: "aks-a", location: "westeurope", resourceGroup: "rg" }]),
      stderr: "",
    });

    const result = await listCloudClusters("AKS", undefined, "sub-123");

    expect(createCliCommand).toHaveBeenCalledWith(
      "az",
      expect.arrayContaining(["--subscription", "sub-123"]),
    );
    expect(result.clusters[0].scope).toBe("sub-123");
  });
});

// ---------------------------------------------------------------------------
// listCloudScopes
// ---------------------------------------------------------------------------

describe("listCloudScopes", () => {
  it("returns AWS profiles from `aws configure list-profiles`", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: "default\nprod\nstaging",
      stderr: "",
    });

    const result = await listCloudScopes("AWS EKS");

    expect(result.label).toBe("Profile");
    expect(result.scopes).toEqual([
      { id: "default", label: "default" },
      { id: "prod", label: "prod" },
      { id: "staging", label: "staging" },
    ]);
  });

  it("returns GCP projects", async () => {
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ projectId: "prod-p" }, { projectId: "dev-p" }]),
      stderr: "",
    });

    const result = await listCloudScopes("GKE");

    expect(result.label).toBe("Project");
    expect(result.scopes.map((s) => s.id)).toEqual(["prod-p", "dev-p"]);
  });

  it("returns empty with label for providers without scopes (DigitalOcean)", async () => {
    const result = await listCloudScopes("DigitalOcean");
    expect(result.scopes).toEqual([]);
    expect(result.label).toBe("Scope");
  });

  it("returns error on CLI failure", async () => {
    mockExecute.mockResolvedValue({ code: 1, stdout: "", stderr: "AccessDenied" });

    const result = await listCloudScopes("AWS EKS");
    expect(result.scopes).toEqual([]);
    expect(result.error).toContain("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// listCloudClustersAllScopes
// ---------------------------------------------------------------------------

describe("listCloudClustersAllScopes", () => {
  it("iterates all AWS profiles and merges clusters", async () => {
    mockExecuteByArgs.mockImplementation((_tool, args) => {
      if (args.includes("list-profiles")) {
        return { code: 0, stdout: "prod\nstaging", stderr: "" };
      }
      if (args.includes("describe-regions")) {
        return { code: 0, stdout: JSON.stringify(["us-east-1"]), stderr: "" };
      }
      if (args.includes("list-clusters")) {
        const profileIdx = args.indexOf("--profile");
        const profile = profileIdx >= 0 ? args[profileIdx + 1] : "default";
        return {
          code: 0,
          stdout: JSON.stringify({ clusters: [`${profile}-cluster`] }),
          stderr: "",
        };
      }
      return undefined;
    });

    const result = await listCloudClustersAllScopes("AWS EKS");

    expect(result.clusters).toHaveLength(2);
    const names = result.clusters.map((c) => c.name).sort();
    expect(names).toEqual(["prod-cluster", "staging-cluster"]);
    const scopes = result.clusters.map((c) => c.scope).sort();
    expect(scopes).toEqual(["prod", "staging"]);
    expect(result.errors).toEqual([]);
  });

  it("reports errors for failed scopes but keeps successful ones", async () => {
    mockExecuteByArgs.mockImplementation((_tool, args) => {
      if (args.includes("list-profiles")) {
        return { code: 0, stdout: "good\nbad", stderr: "" };
      }
      const profileIdx = args.indexOf("--profile");
      const profile = profileIdx >= 0 ? args[profileIdx + 1] : "default";
      if (profile === "bad") {
        return { code: 1, stdout: "", stderr: "ExpiredToken" };
      }
      if (args.includes("describe-regions")) {
        return { code: 0, stdout: JSON.stringify(["us-east-1"]), stderr: "" };
      }
      if (args.includes("list-clusters")) {
        return { code: 0, stdout: JSON.stringify({ clusters: ["ok-cluster"] }), stderr: "" };
      }
      return undefined;
    });

    const result = await listCloudClustersAllScopes("AWS EKS");

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].name).toBe("ok-cluster");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].scope).toBe("bad");
    expect(result.errors[0].error).toContain("ExpiredToken");
  });

  it("falls back to default credentials when provider has no scopes", async () => {
    // DigitalOcean - no scopes, just a direct list
    mockExecute.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ name: "do-a", region_slug: "nyc1" }]),
      stderr: "",
    });

    const result = await listCloudClustersAllScopes("DigitalOcean");

    expect(result.clusters).toHaveLength(1);
    expect(result.errors).toEqual([]);
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
