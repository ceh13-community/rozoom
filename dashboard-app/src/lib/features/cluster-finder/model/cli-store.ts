import { get, writable } from "svelte/store";
import {
  detectAvailableClis,
  detectCloudConfigs,
  detectOsToolPresence,
  detectOsTools,
  type DetectedCli,
  type DetectedCloudConfig,
  type DetectedOsTool,
} from "../api/cli-detection";
import type { InstallManifest } from "$shared/config/tooling";

export const detectedClis = writable<DetectedCli[]>([]);
export const detectedOsTools = writable<DetectedOsTool[]>([]);
export const detectedCloudConfigs = writable<DetectedCloudConfig[]>([]);
export const isCliDetectionLoading = writable(false);

async function loadManifest(): Promise<InstallManifest> {
  try {
    const resp = await fetch("/binaries/install-manifest.json", { cache: "no-store" });
    if (!resp.ok) return {};
    return (await resp.json()) as InstallManifest;
  } catch {
    return {};
  }
}

export async function loadDetectedClis(): Promise<void> {
  isCliDetectionLoading.set(true);
  try {
    const [manifest, osTools, configs] = await Promise.all([
      loadManifest(),
      detectOsTools(),
      detectCloudConfigs(),
    ]);
    const clis = await detectAvailableClis(manifest);
    detectedClis.set(clis);
    detectedOsTools.set(osTools);
    detectedCloudConfigs.set(configs);
  } catch {
    detectedClis.set([]);
    detectedOsTools.set([]);
    detectedCloudConfigs.set([]);
  } finally {
    isCliDetectionLoading.set(false);
  }
}

/**
 * Which cloud CLIs are installed, for Cloud Import, before the person runs the full scan:
 * `which` only, the CLIs themselves are not run. A full scan already done is kept.
 */
export async function loadCloudCliPresence(tools: readonly string[]): Promise<void> {
  if (get(detectedOsTools).length > 0) return;
  try {
    const found = await detectOsToolPresence(tools);
    if (get(detectedOsTools).length === 0) detectedOsTools.set(found);
  } catch {
    // Detection is best-effort: without it no installed CLI is offered.
  }
}
