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
  /** Scope identifier: AWS profile, GCP project, or Azure subscription. */
  scope?: string;
};

export type CloudImportResult = {
  success: boolean;
  kubeconfigYaml?: string;
  error?: string;
};

export type CloudScope = {
  id: string;
  label: string;
};

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

type ProviderConfig = {
  tool: CliTool;
  /**
   * Build the args for a single list call. For cross-region providers this
   * is called once per region. The optional `scope` is provider-specific:
   * AWS profile, GCP project, or Azure subscription id.
   */
  listArgs: (region?: string, scope?: string) => string[];
  parseList: (stdout: string, region: string, scope?: string) => CloudCluster[];
  importArgs: (cluster: CloudCluster) => string[];
  /**
   * When set, the provider supports cross-region discovery.
   * `regionsArgs` returns args for a CLI call that lists enabled regions.
   * `parseRegions` extracts the region codes from its stdout.
   */
  crossRegion?: {
    regionsArgs: (scope?: string) => string[];
    parseRegions: (stdout: string) => string[];
  };
  /**
   * When set, the provider supports multi-scope discovery (profiles,
   * projects, subscriptions). `label` is the user-facing name.
   */
  scopes?: {
    label: string;
    listArgs: () => string[];
    parseList: (stdout: string) => CloudScope[];
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

export function parseAwsEksList(stdout: string, region: string, scope?: string): CloudCluster[] {
  try {
    const data = JSON.parse(stdout) as { clusters?: string[] };
    return (data.clusters ?? []).map((name) => ({
      name,
      region,
      provider: "AWS EKS" as ClusterProvider,
      ...(scope ? { scope } : {}),
    }));
  } catch {
    return [];
  }
}

export function parseAwsProfiles(stdout: string): CloudScope[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

export function parseGkeList(stdout: string, _region?: string, scope?: string): CloudCluster[] {
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
      ...(scope ? { scope } : {}),
    }));
  } catch {
    return [];
  }
}

export function parseGcpProjects(stdout: string): CloudScope[] {
  try {
    const data = JSON.parse(stdout) as Array<{ projectId?: string; name?: string }>;
    return data
      .map((p) => p.projectId ?? "")
      .filter(Boolean)
      .map((id) => ({ id, label: id }));
  } catch {
    return [];
  }
}

export function parseAksList(stdout: string, _region?: string, scope?: string): CloudCluster[] {
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
      ...(scope ? { scope } : {}),
    }));
  } catch {
    return [];
  }
}

export function parseAzureSubscriptions(stdout: string): CloudScope[] {
  try {
    const data = JSON.parse(stdout) as Array<{ id?: string; name?: string }>;
    return data
      .filter((s) => s.id)
      .map((s) => ({ id: s.id ?? "", label: s.name ? `${s.name} (${s.id})` : (s.id ?? "") }));
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
    listArgs: (region, scope) => [
      "eks",
      "list-clusters",
      "--output",
      "json",
      ...(region ? ["--region", region] : []),
      ...(scope ? ["--profile", scope] : []),
    ],
    parseList: parseAwsEksList,
    importArgs: (cluster) => [
      "eks",
      "update-kubeconfig",
      "--name",
      cluster.name,
      "--region",
      cluster.region,
      ...(cluster.scope ? ["--profile", cluster.scope] : []),
      "--kubeconfig",
      "/dev/stdout",
    ],
    crossRegion: {
      regionsArgs: (scope) => [
        "ec2",
        "describe-regions",
        "--filters",
        "Name=opt-in-status,Values=opt-in-not-required,opted-in",
        "--query",
        "Regions[].RegionName",
        "--output",
        "json",
        ...(scope ? ["--profile", scope] : []),
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
    scopes: {
      label: "Profile",
      listArgs: () => ["configure", "list-profiles"],
      parseList: parseAwsProfiles,
    },
  },
  GKE: {
    tool: "gcloud",
    listArgs: (_region, scope) => [
      "container",
      "clusters",
      "list",
      "--format=json(name,zone,location)",
      ...(scope ? [`--project=${scope}`] : []),
    ],
    parseList: parseGkeList,
    importArgs: (cluster) => [
      "container",
      "clusters",
      "get-credentials",
      cluster.name,
      "--zone",
      cluster.region,
      ...(cluster.scope ? [`--project=${cluster.scope}`] : []),
      "--kubeconfig",
      "/dev/stdout",
    ],
    scopes: {
      label: "Project",
      listArgs: () => ["projects", "list", "--format=json"],
      parseList: parseGcpProjects,
    },
  },
  AKS: {
    tool: "az",
    listArgs: (_region, scope) => [
      "aks",
      "list",
      "--output",
      "json",
      ...(scope ? ["--subscription", scope] : []),
    ],
    parseList: parseAksList,
    importArgs: (cluster) => [
      "aks",
      "get-credentials",
      "--name",
      cluster.name,
      "--resource-group",
      cluster.resourceGroup ?? "",
      ...(cluster.scope ? ["--subscription", cluster.scope] : []),
      "--overwrite-existing",
      "--file",
      "/dev/stdout",
    ],
    scopes: {
      label: "Subscription",
      listArgs: () => ["account", "list", "--output", "json"],
      parseList: parseAzureSubscriptions,
    },
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
 *
 * Optional `scope` narrows the discovery to a specific profile (AWS),
 * project (GCP) or subscription (Azure).
 */
export async function listCloudClusters(
  provider: string,
  region?: string,
  scope?: string,
): Promise<{ clusters: CloudCluster[]; error?: string }> {
  const config = PROVIDERS[provider];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, provider comes from user input
  if (!config) return { clusters: [], error: `Unsupported provider: ${provider}` };

  try {
    // Cross-region discovery (AWS EKS) when no specific region is given
    const { crossRegion } = config;
    if (!region && crossRegion) {
      return await listCrossRegion({ ...config, crossRegion }, scope);
    }

    const res = await execProvider(config.tool, config.listArgs(region, scope));
    if (res.code !== 0) {
      return { clusters: [], error: res.stderr || `Exit code ${res.code}` };
    }
    return { clusters: config.parseList(res.stdout, region ?? "default", scope) };
  } catch (err) {
    return { clusters: [], error: (err as Error).message };
  }
}

/**
 * List all available scopes (profiles / projects / subscriptions) for a
 * provider. Returns empty array if the provider has no scope concept.
 */
export async function listCloudScopes(
  provider: string,
): Promise<{ scopes: CloudScope[]; label: string; error?: string }> {
  const config = PROVIDERS[provider];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard
  if (!config) return { scopes: [], label: "Scope", error: `Unsupported provider: ${provider}` };
  if (!config.scopes) return { scopes: [], label: "Scope" };

  try {
    const res = await execProvider(config.tool, config.scopes.listArgs());
    if (res.code !== 0) {
      return {
        scopes: [],
        label: config.scopes.label,
        error: res.stderr || `Exit code ${res.code}`,
      };
    }
    return {
      scopes: config.scopes.parseList(res.stdout),
      label: config.scopes.label,
    };
  } catch (err) {
    return { scopes: [], label: config.scopes.label, error: (err as Error).message };
  }
}

/**
 * Discover clusters across ALL available scopes (e.g. every AWS profile,
 * every GCP project, every Azure subscription). Failed scopes are collected
 * and reported alongside the successful results.
 */
export async function listCloudClustersAllScopes(
  provider: string,
): Promise<{ clusters: CloudCluster[]; errors: Array<{ scope: string; error: string }> }> {
  const { scopes, error: scopesError } = await listCloudScopes(provider);

  // No scope support (e.g. DigitalOcean) or discovery failed - fall back
  // to a single default-credentials scan.
  if (scopesError || scopes.length === 0) {
    const result = await listCloudClusters(provider);
    const errors = result.error ? [{ scope: "default", error: result.error }] : [];
    return { clusters: result.clusters, errors };
  }

  const settled = await Promise.allSettled(
    scopes.map(async (scope) => {
      const result = await listCloudClusters(provider, undefined, scope.id);
      return { scope: scope.id, result };
    }),
  );

  const clusters: CloudCluster[] = [];
  const errors: Array<{ scope: string; error: string }> = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      errors.push({ scope: "unknown", error: String(outcome.reason) });
      continue;
    }
    const { scope, result } = outcome.value;
    if (result.error) {
      errors.push({ scope, error: result.error });
    }
    clusters.push(...result.clusters);
  }

  return { clusters, errors };
}

/**
 * Query all enabled regions in parallel and merge cluster lists.
 */
async function listCrossRegion(
  config: ProviderConfig & { crossRegion: NonNullable<ProviderConfig["crossRegion"]> },
  scope?: string,
): Promise<{ clusters: CloudCluster[]; error?: string }> {
  const regResult = await execProvider(config.tool, config.crossRegion.regionsArgs(scope));
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
      const res = await execProvider(config.tool, config.listArgs(r, scope));
      if (res.code !== 0) return [];
      return config.parseList(res.stdout, r, scope);
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
