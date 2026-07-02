/**
 * P3 auto-discovery: select the LOCAL-runtime contexts out of a scanned
 * kubeconfig so the first-run screen can offer one-click connect.
 *
 * Pure decision layer — takes the already-parsed kubeconfig (see
 * cluster-finder/api/scanner.ts, which gets it via `kubectl config view`
 * and therefore already honours $KUBECONFIG merging) and reuses the
 * existing provider classifier. We deliberately surface ONLY
 * `local-runtime` clusters (minikube / kind / k3d / docker-desktop …);
 * remote/managed contexts go through the token form (Path B), per the
 * Frictionless Connection UX spec.
 *
 * No I/O, no Tauri, no side effects — trivially testable.
 */
import type { KubeConfigFileType } from "$entities/config";
import { detectClusterProvider, type ClusterProvider } from "$shared/lib/provider-detection";
import { scanKubeconfigs } from "../api/scanner";

export type DiscoveredLocalCluster = {
  /** kubeconfig context name — what we connect by. */
  contextName: string;
  /** cluster the context points at. */
  clusterName: string;
  /** API server URL, when present in the config. */
  server: string | null;
  /** classified local runtime, for the UI label/icon. */
  provider: ClusterProvider;
};

/**
 * Join contexts → clusters → users and keep only the ones the provider
 * classifier marks as `local-runtime`. Order is preserved from the
 * kubeconfig so the UI can make the first / last-used entry primary.
 */
export function selectLocalContexts(config: KubeConfigFileType): DiscoveredLocalCluster[] {
  const clusterByName = new Map(config.clusters.map((c) => [c.name, c]));
  const userByName = new Map(config.users.map((u) => [u.name, u]));

  const local: DiscoveredLocalCluster[] = [];

  for (const ctx of config.contexts) {
    const cluster = clusterByName.get(ctx.context.cluster);
    const user = userByName.get(ctx.context.user);

    const { provider, category } = detectClusterProvider({
      clusterName: ctx.context.cluster,
      contextName: ctx.name,
      serverUrl: cluster?.server ?? null,
      execCommand: user?.execCommand ?? null,
      execArgs: user?.execArgs ?? null,
      authProvider: user?.authProvider ?? null,
    });

    if (category !== "local-runtime") continue;

    local.push({
      contextName: ctx.name,
      clusterName: ctx.context.cluster,
      server: cluster?.server ?? null,
      provider,
    });
  }

  return local;
}

/**
 * First-run entry point: scan the user's kubeconfig (via the kubectl
 * sidecar — no Tauri fs scope needed) and return the local-runtime
 * clusters ready for one-click connect. Returns [] when no kubeconfig is
 * present or it has no local contexts, so the wizard can fall straight
 * back to the manual token path.
 */
export async function discoverLocalClusters(): Promise<DiscoveredLocalCluster[]> {
  const config = await scanKubeconfigs();
  if (!config) return [];
  return selectLocalContexts(config);
}
