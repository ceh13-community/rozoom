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
 * Which cloud CLIs are installed, for Cloud Import: `which` only, the CLIs themselves are
 * not run. Tools a probe already looked at are not probed again.
 */
export async function loadCloudCliPresence(tools: readonly string[]): Promise<void> {
  const known = new Set(get(detectedOsTools).map((tool) => tool.tool));
  const missing = tools.filter((tool) => !known.has(tool));
  if (missing.length === 0) return;
  try {
    const found = await detectOsToolPresence(missing);
    detectedOsTools.update((current) => mergeOsTools(found, current));
  } catch {
    // Detection is best-effort: without it no installed CLI is offered.
  }
}

/**
 * Looks again with `which` (on Scan): a cloud CLI removed since the app started is no longer
 * offered and one installed since then is, without a restart. The new result wins.
 */
export async function recheckCloudCliPresence(tools: readonly string[]): Promise<void> {
  if (tools.length === 0) return;
  try {
    const found = await detectOsToolPresence(tools);
    detectedOsTools.update((current) => mergeOsTools(current, found));
  } catch {
    // A failed probe proves nothing about the CLI: keep what is known.
  }
}
