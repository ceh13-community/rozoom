import { writable } from "svelte/store";
import {
  detectAvailableClis,
  detectCloudConfigs,
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
