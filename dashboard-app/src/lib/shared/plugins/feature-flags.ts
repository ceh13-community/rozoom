/**
 * ROZOOM Feature Flag System.
 *
 * Controls which plugins and features are active based on:
 *   1. Plugin tier (core always on)
 *   2. License validation (pro requires valid license)
 *   3. User preferences (free plugins can be toggled)
 *   4. Trial period (pro plugins have 14-day trial)
 */

import { writable, get } from "svelte/store";
import { storeManager } from "$shared/store";
import type { PluginLicense, PluginManifest, InstalledPlugin } from "./types";
import { BUILTIN_PLUGINS } from "./registry";

const STORE_NAME = "dashboard-preferences.json";
const LICENSES_KEY = "pluginLicenses";
const DISABLED_KEY = "disabledPlugins";

export const pluginLicenses = writable<Record<string, PluginLicense>>({});
export const disabledPlugins = writable<Set<string>>(new Set());

export async function loadPluginState(): Promise<void> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const licenses = (await store.get(LICENSES_KEY)) as Record<string, PluginLicense> | null;
    const disabled = (await store.get(DISABLED_KEY)) as string[] | null;
    if (licenses) pluginLicenses.set(licenses);
    if (disabled) disabledPlugins.set(new Set(disabled));
  } catch {
    // best-effort
  }
}

export async function saveLicense(pluginId: string, license: PluginLicense): Promise<void> {
  pluginLicenses.update((all) => ({ ...all, [pluginId]: license }));
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(LICENSES_KEY, get(pluginLicenses));
    await store.save();
  } catch {
    // best-effort
  }
}

export async function togglePlugin(pluginId: string): Promise<void> {
  disabledPlugins.update((set) => {
    const next = new Set(set);
    if (next.has(pluginId)) next.delete(pluginId);
    else next.add(pluginId);
    return next;
  });
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(DISABLED_KEY, [...get(disabledPlugins)]);
    await store.save();
  } catch {
    // best-effort
  }
}

export function isPluginActive(plugin: PluginManifest): boolean {
  // Core plugins always active
  if (plugin.tier === "core") return true;

  // User disabled
  if (get(disabledPlugins).has(plugin.id)) return false;

  // Free plugins always active unless disabled
  if (plugin.tier === "free") return true;

  // Pro plugins need license or trial
  if (plugin.tier === "pro") {
    const license = get(pluginLicenses)[plugin.id];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, license store may not have entry
    if (!license) {
      // Check trial: auto-grant 14-day trial on first access
      return isTrialActive(plugin);
    }
    return license.valid && (!license.expiresAt || new Date(license.expiresAt) > new Date());
  }

  // Community plugins active if installed
  return true;
}

function isTrialActive(plugin: PluginManifest): boolean {
  if (!plugin.pricing?.trialDays) return false;
  const license = get(pluginLicenses)[plugin.id];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, license store may not have entry
  if (!license) return true; // Not yet activated = trial available
  if (!license.activatedAt) return true;
  const activatedAt = new Date(license.activatedAt);
  const trialEnd = new Date(activatedAt.getTime() + plugin.pricing.trialDays * 24 * 60 * 60 * 1000);
  return new Date() < trialEnd;
}

export function getTrialDaysRemaining(plugin: PluginManifest): number | null {
  if (!plugin.pricing?.trialDays) return null;
  const license = get(pluginLicenses)[plugin.id];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, license may be undefined
  if (!license?.activatedAt) return plugin.pricing.trialDays;
  const activatedAt = new Date(license.activatedAt);
  const trialEnd = new Date(activatedAt.getTime() + plugin.pricing.trialDays * 24 * 60 * 60 * 1000);
  const remaining = Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

export function getInstalledPlugins(): InstalledPlugin[] {
  const licenses = get(pluginLicenses);
  const disabled = get(disabledPlugins);

  return BUILTIN_PLUGINS.map((manifest) => ({
    manifest,
    status: disabled.has(manifest.id) ? ("inactive" as const) : ("active" as const),
    installedAt: new Date().toISOString(),
    license: licenses[manifest.id],
  }));
}

export function isFeatureAvailable(featureId: string): boolean {
  for (const plugin of BUILTIN_PLUGINS) {
    const provides = plugin.provides;
    const allFeatures = [
      ...(provides.workloadPages?.map((p) => p.id) ?? []),
      ...(provides.healthChecks ?? []),
      ...(provides.analysisModules ?? []),
      ...(provides.dashboardWidgets ?? []),
      ...(provides.helmCharts ?? []),
    ];
    if (allFeatures.includes(featureId)) {
      return isPluginActive(plugin);
    }
  }
  return true; // Unknown features default to available
}
