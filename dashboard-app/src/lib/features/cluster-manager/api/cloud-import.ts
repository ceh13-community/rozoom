import { createCliCommand, type CliTool } from "$shared/api/cli";
import { appDataDir } from "@tauri-apps/api/path";
import { readTextFile, remove } from "@tauri-apps/plugin-fs";
import type { ClusterProvider } from "$shared/lib/provider-detection";

export type CloudCluster = {
  name: string;
  region: string;
  provider: ClusterProvider;
  /** Azure resource group (AKS only). */
  resourceGroup?: string;
};

export type CloudImportResult = {
  success: boolean;
  kubeconfigYaml?: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

type ProviderConfig = {
  tool: CliTool;
  /** Build the args for a single list call.  For cross-region providers this is called once per region. */
  listArgs: (region?: string) => string[];
  parseList: (stdout: string, region: string) => CloudCluster[];
  importArgs: (cluster: CloudCluster) => string[];
  /**
   * When set, the provider supports cross-region discovery.
   * `regionsArgs` returns args for a CLI call that lists enabled regions.
   * `parseRegions` extracts the region codes from its stdout.
   */
  crossRegion?: {
    regionsArgs: () => string[];
    parseRegions: (stdout: string) => string[];
  };
};

// -- helpers exposed for tests -----------------------------------------------

export function parseAwsRegions(stdout: string): string[] {
  try {
    const data = JSON.parse(stdout) as {
      Regions?: Array<{ RegionName?: string }>;
    };
    return (data.Regions ?? [])
      .map((r) => r.RegionName ?? "")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

export function parseAwsEksList(stdout: string, region: string): CloudCluster[] {
  try {
    const data = JSON.parse(stdout) as { clusters?: string[] };
    return (data.clusters ?? []).map((name) => ({
      name,
      region,
      provider: "AWS EKS" as ClusterProvider,
    }));
  } catch {
    return [];
  }
}

export function parseGkeList(stdout: string): CloudCluster[] {
  try {
    const data = JSON.parse(stdout) as Array<{
      name: string;
      zone?: string;
      location?: string;
    }>;
    return data.map((entry) => ({
      name: entry.name,
      region: entry.location ?? entry.zone ?? "unknown",
      provider: "GKE" as ClusterProvider,
    }));
  } catch {
    return [];
  }
}

export function parseAksList(stdout: string): CloudCluster[] {
  try {
    const data = JSON.parse(stdout) as Array<{
      name: string;
      location: string;
      resourceGroup: string;
    }>;
    return data.map((entry) => ({
      name: entry.name,
      region: entry.location,
      provider: "AKS" as ClusterProvider,
      resourceGroup: entry.resourceGroup,
    }));
  } catch {
    return [];
  }
}

export function parseDoksList(stdout: string): CloudCluster[] {
  try {
    const data = JSON.parse(stdout) as Array<{
      id?: string;
      name: string;
      region?: string;
      region_slug?: string;
    }>;
    return data.map((entry) => ({
      name: entry.name,
      region: entry.region_slug ?? entry.region ?? "unknown",
      provider: "DigitalOcean" as ClusterProvider,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, ProviderConfig> = {
  "AWS EKS": {
    tool: "aws",
    listArgs: (region) => [
      "eks",
      "list-clusters",
      "--output",
      "json",
      ...(region ? ["--region", region] : []),
    ],
    parseList: parseAwsEksList,
    importArgs: (cluster) => [
      "eks",
      "update-kubeconfig",
      "--name",
      cluster.name,
      "--region",
      cluster.region,
      "--kubeconfig",
      "/dev/stdout",
    ],
    crossRegion: {
      regionsArgs: () => [
        "ec2",
        "describe-regions",
        "--filters",
        "Name=opt-in-status,Values=opt-in-not-required,opted-in",
        "--query",
        "Regions[].RegionName",
        "--output",
        "json",
      ],
      parseRegions: (stdout) => {
        try {
          const data = JSON.parse(stdout) as string[];
          return Array.isArray(data) ? data.filter(Boolean).sort() : [];
        } catch {
          return [];
        }
      },
    },
  },
  GKE: {
    tool: "gcloud",
    listArgs: () => ["container", "clusters", "list", "--format=json(name,zone,location)"],
    parseList: (stdout) => parseGkeList(stdout),
    importArgs: (cluster) => [
      "container",
      "clusters",
      "get-credentials",
      cluster.name,
      "--zone",
      cluster.region,
      "--kubeconfig",
      "/dev/stdout",
    ],
  },
  AKS: {
    tool: "az",
    listArgs: () => ["aks", "list", "--output", "json"],
    parseList: (stdout) => parseAksList(stdout),
    importArgs: (cluster) => [
      "aks",
      "get-credentials",
      "--name",
      cluster.name,
      "--resource-group",
      cluster.resourceGroup ?? "",
      "--overwrite-existing",
      "--file",
      "/dev/stdout",
    ],
  },
  DigitalOcean: {
    tool: "doctl",
    listArgs: () => ["kubernetes", "cluster", "list", "--output", "json"],
    parseList: (stdout) => parseDoksList(stdout),
    importArgs: (cluster) => ["kubernetes", "cluster", "kubeconfig", "show", cluster.name],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSupportedCloudProviders(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * Execute a single CLI command and return stdout/stderr.
 * Shared helper for list and region-discovery calls.
 */
async function execProvider(
  tool: CliTool,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = await createCliCommand(tool, args);
  const result = await command.execute();
  return {
    code: typeof result.code === "number" ? result.code : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

/**
 * List clusters for a given cloud provider.
 *
 * When `region` is omitted and the provider supports cross-region discovery
 * (currently AWS EKS), all enabled regions are queried in parallel.
 */
export async function listCloudClusters(
  provider: string,
  region?: string,
): Promise<{ clusters: CloudCluster[]; error?: string }> {
  const config = PROVIDERS[provider];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, provider comes from user input
  if (!config) return { clusters: [], error: `Unsupported provider: ${provider}` };

  try {
    // Cross-region discovery (AWS EKS) when no specific region is given
    const { crossRegion } = config;
    if (!region && crossRegion) {
      return await listCrossRegion({ ...config, crossRegion });
    }

    const res = await execProvider(config.tool, config.listArgs(region));
    if (res.code !== 0) {
      return { clusters: [], error: res.stderr || `Exit code ${res.code}` };
    }
    return { clusters: config.parseList(res.stdout, region ?? "default") };
  } catch (err) {
    return { clusters: [], error: (err as Error).message };
  }
}

/**
 * Query all enabled regions in parallel and merge cluster lists.
 */
async function listCrossRegion(
  config: ProviderConfig & { crossRegion: NonNullable<ProviderConfig["crossRegion"]> },
): Promise<{ clusters: CloudCluster[]; error?: string }> {
  const regResult = await execProvider(config.tool, config.crossRegion.regionsArgs());
  if (regResult.code !== 0) {
    return {
      clusters: [],
      error: `Failed to list regions: ${regResult.stderr || `exit ${regResult.code}`}`,
    };
  }
  const regions = config.crossRegion.parseRegions(regResult.stdout);
  if (regions.length === 0) {
    return { clusters: [], error: "No enabled regions found" };
  }

  const settled = await Promise.allSettled(
    regions.map(async (r) => {
      const res = await execProvider(config.tool, config.listArgs(r));
      if (res.code !== 0) return [];
      return config.parseList(res.stdout, r);
    }),
  );

  const clusters = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  return { clusters };
}

export async function importCloudCluster(cluster: CloudCluster): Promise<CloudImportResult> {
  const config = PROVIDERS[cluster.provider];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, provider comes from user input
  if (!config) return { success: false, error: `Unsupported provider: ${cluster.provider}` };

  try {
    const baseArgs = config.importArgs(cluster);
    const usesDevStdout = baseArgs.includes("/dev/stdout");

    // Cloud CLIs (aws, az, gcloud) write kubeconfig to a file path.
    // /dev/stdout works in a terminal but not reliably through Tauri's
    // piped process, so we redirect to a temp file and read it back.
    if (usesDevStdout) {
      const dataDir = await appDataDir();
      const tmpPath = `${dataDir}/tmp-cloud-import-${Date.now()}.yaml`;
      const args = baseArgs.map((a) => (a === "/dev/stdout" ? tmpPath : a));
      const res = await execProvider(config.tool, args);
      if (res.code !== 0) {
        await remove(tmpPath).catch(() => {});
        return { success: false, error: res.stderr || `Exit code ${res.code}` };
      }
      try {
        const yaml = await readTextFile(tmpPath);
        await remove(tmpPath).catch(() => {});
        return { success: true, kubeconfigYaml: yaml || undefined };
      } catch {
        return { success: false, error: "Import succeeded but failed to read kubeconfig file" };
      }
    }

    // DigitalOcean (doctl) outputs kubeconfig directly to stdout.
    const res = await execProvider(config.tool, baseArgs);
    if (res.code !== 0) {
      return { success: false, error: res.stderr || `Exit code ${res.code}` };
    }
    return { success: true, kubeconfigYaml: res.stdout || undefined };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
