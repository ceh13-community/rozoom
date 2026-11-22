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
    detectedOsTools.set(mergeOsTools(get(detectedOsTools), osTools));
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
 * Tools found by a newer probe replace the same tools from an older one; tools the newer
 * probe did not look at stay. The full scan on slim probes only the tools the build enables
 * (kubectl, helm) and used to drop the cloud CLIs the presence check had found.
 */
export function mergeOsTools(
  previous: readonly DetectedOsTool[],
  next: readonly DetectedOsTool[],
): DetectedOsTool[] {
  const probed = new Set(next.map((tool) => tool.tool));
  return [...previous.filter((tool) => !probed.has(tool.tool)), ...next];
}

/**
 * Which cloud CLIs are installed, for Cloud Import, when the wizard opens: `which` only, the
 * CLIs themselves are not run. A CLI already found is not probed again; one not found (or not
 * probed yet) is, so a CLI installed since the last look shows up without a restart.
 */
export async function loadCloudCliPresence(tools: readonly string[]): Promise<void> {
  const found = new Set(
    get(detectedOsTools)
      .filter((tool) => tool.available)
      .map((tool) => tool.tool),
  );
  await recheckCloudCliPresence(tools.filter((tool) => !found.has(tool)));
}

/**
 * Looks again with `which` (on Scan): a cloud CLI removed since the app started is no longer
 * offered and one installed since then is, without a restart. The new result wins; a tool
 * the probe could not answer for is not in it, so what is known about it stays.
 */
export async function recheckCloudCliPresence(tools: readonly string[]): Promise<void> {
  if (tools.length === 0) return;
  const probed = await detectOsToolPresence(tools);
  detectedOsTools.update((current) => mergeOsTools(current, probed));
}
