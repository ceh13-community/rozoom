/**
 * Import/Export cluster catalog.
 *
 * Exports groups, tags, display names, and environment assignments
 * WITHOUT secrets or kubeconfig data. Safe for sharing across machines.
 */

import type { AppClusterConfig } from "$entities/config";
import type { ClusterGroup } from "$shared/lib/cluster-groups";

export type CatalogExport = {
  version: 1;
  exportedAt: string;
  clusters: CatalogClusterEntry[];
  groups: ClusterGroup[];
  groupMembership: Record<string, string>;
};

type CatalogClusterEntry = {
  name: string;
  displayName?: string;
  env?: string;
  provider?: string;
  tags?: string[];
  defaultNamespace?: string;
  readOnly?: boolean;
};

export function exportCatalog(
  clusters: AppClusterConfig[],
  groups: ClusterGroup[],
  membership: Record<string, string>,
): CatalogExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    clusters: clusters.map((c) => ({
      name: c.name,
      ...(c.displayName ? { displayName: c.displayName } : {}),
      ...(c.env ? { env: c.env } : {}),
      ...(c.provider ? { provider: c.provider } : {}),
      ...(c.tags?.length ? { tags: c.tags } : {}),
      ...(c.defaultNamespace ? { defaultNamespace: c.defaultNamespace } : {}),
      ...(c.readOnly ? { readOnly: c.readOnly } : {}),
    })),
    groups,
    groupMembership: membership,
  };
}

export function importCatalog(
  raw: string,
): { catalog: CatalogExport; error?: string } | { catalog?: never; error: string } {
  try {
    const parsed = JSON.parse(raw) as CatalogExport;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for external JSON data
    if (parsed.version !== 1) {
      return { error: `Unsupported catalog version: ${parsed.version}` };
    }
    if (!Array.isArray(parsed.clusters)) {
      return { error: "Invalid catalog: missing clusters array" };
    }
    return { catalog: parsed };
  } catch (err) {
    return { error: `Failed to parse catalog: ${(err as Error).message}` };
  }
}

export function applyCatalogToCluster(
  existing: AppClusterConfig,
  catalogEntry: CatalogClusterEntry,
): Partial<AppClusterConfig> {
  const updates: Partial<AppClusterConfig> = {};

  if (catalogEntry.displayName) updates.displayName = catalogEntry.displayName;
  if (catalogEntry.env) updates.env = catalogEntry.env;
  if (catalogEntry.provider) updates.provider = catalogEntry.provider;
  if (catalogEntry.tags?.length) updates.tags = catalogEntry.tags;
  if (catalogEntry.defaultNamespace) updates.defaultNamespace = catalogEntry.defaultNamespace;
  if (catalogEntry.readOnly !== undefined) updates.readOnly = catalogEntry.readOnly;

  return updates;
}
