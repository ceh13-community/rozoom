/**
 * Shared local-runtime scan state (P3 discovery).
 *
 * `scanKubeconfigs` + `selectLocalContexts` used to be called from inside
 * ConnectClusterWizard's own component state only, so the Screen 0
 * "Refresh" button (cluster-manager.svelte, kubeconfig panel) had no way
 * to also re-run the local-cluster scan: after `kind create cluster`,
 * Refresh picked up the new kubeconfig entry but the wizard's "Local
 * clusters" list stayed stale until the user separately clicked Rescan.
 * Lifting the scan into a store (same pattern as cli-store.ts) lets both
 * surfaces trigger and read the same scan.
 */
import { writable } from "svelte/store";
import type { KubeConfigFileType } from "$entities/config";
import { scanKubeconfigs } from "../api/scanner";
import { selectLocalContexts, type DiscoveredLocalCluster } from "./local-discovery";

export const localScanClusters = writable<DiscoveredLocalCluster[]>([]);
export const localScanConfig = writable<KubeConfigFileType | null>(null);
export const isLocalScanning = writable(false);
export const localScanned = writable(false);
/** Raw error message from the last scan attempt; callers humanize as needed. */
export const localScanError = writable<string | null>(null);

export async function runLocalDiscoveryScan(): Promise<void> {
  isLocalScanning.set(true);
  localScanError.set(null);
  localScanClusters.set([]);
  try {
    const config = await scanKubeconfigs();
    localScanConfig.set(config);
    localScanClusters.set(config ? selectLocalContexts(config) : []);
  } catch (e) {
    localScanConfig.set(null);
    localScanClusters.set([]);
    localScanError.set((e as Error).message);
  } finally {
    isLocalScanning.set(false);
    localScanned.set(true);
  }
}

/** Reset to pre-scan state, e.g. after the user declines/revokes consent. */
export function clearLocalScan(): void {
  localScanClusters.set([]);
  localScanConfig.set(null);
  localScanError.set(null);
}
