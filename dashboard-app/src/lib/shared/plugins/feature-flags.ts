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
const PREFS_VERSION_KEY = "pluginPrefsVersion";

/**
 * Schema version for the plugin preferences block. Bump when the set of
 * `defaultDisabled` plugins changes in a way that should affect existing
 * users, not just fresh installs. On load, if the stored version is lower,
 * loadPluginState merges the current manifest defaults into the user's
 * disabled set once, then writes the new version. Explicit user enables
 * are not reverted because we only ADD to the set, never remove.
 *
 * v1 (implicit): first-run seed only. Existing users kept whatever they had.
 * v2 (current): default-disable plugins whose pages are not linked from the
 *   Fleet Dashboard cluster card (security-suite, capacity-intelligence,
 *   performance-suite, gitops-integration, workload-visualizer,
 *   cert-rotation). Existing users get these hidden on next launch so the
 *   narrower default reaches them without requiring a manual reset.
 */
const CURRENT_PREFS_VERSION = 2;

export const pluginLicenses = writable<Record<string, PluginLicense>>({});
export const disabledPlugins = writable<Set<string>>(new Set());

/**
 * Plugins that should be off on the first launch of the app. The intent is
 * to keep the default experience focused on what the Fleet Dashboard
 * cluster cards surface; deeper audits (Security, Capacity, Performance,
 * Workload Map, GitOps Bootstrap, Rotate Certificates) are opt-in via the
 * Marketplace. Drawn from the manifest `defaultDisabled` flag so plugin
 * authors control their own default.
 */
function getDefaultDisabledPluginIds(): string[] {
  return BUILTIN_PLUGINS.filter((p) => p.defaultDisabled && p.tier !== "core").map((p) => p.id);
}

export async function loadPluginState(): Promise<void> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const licenses = (await store.get(LICENSES_KEY)) as Record<string, PluginLicense> | null;
    const stored = (await store.get(DISABLED_KEY)) as string[] | null | undefined;
    const storedVersion = ((await store.get(PREFS_VERSION_KEY)) as number | null) ?? 1;
    if (licenses) pluginLicenses.set(licenses);

    // Missing key = first run. Seed from manifest defaults so the user
    // starts with a focused sidebar. Persist immediately so subsequent
    // loads treat this as the user's baseline and future toggles take
    // precedence.
    if (stored === null || stored === undefined) {
      const defaults = getDefaultDisabledPluginIds();
      disabledPlugins.set(new Set(defaults));
      try {
        await store.set(DISABLED_KEY, defaults);
        await store.set(PREFS_VERSION_KEY, CURRENT_PREFS_VERSION);
        await store.save();
      } catch {
        // persistence best-effort
      }
      return;
    }

    // Upgrade path: schema version bumped and this install is still on an
    // older one. Merge (union) current defaults with stored disabled so the
    // narrower policy reaches existing users without reverting their
    // explicit enables - we only add, never remove. Example: user had
    // {security-suite: enabled, gitops-integration: enabled}; after v2
    // migration both become disabled because v2 marks them defaultDisabled.
    // A user who had explicitly disabled other plugins keeps those too.
    if (storedVersion < CURRENT_PREFS_VERSION) {
      const merged = new Set<string>(stored);
      for (const id of getDefaultDisabledPluginIds()) merged.add(id);
      disabledPlugins.set(merged);
      try {
        await store.set(DISABLED_KEY, [...merged]);
        await store.set(PREFS_VERSION_KEY, CURRENT_PREFS_VERSION);
        await store.save();
      } catch {
        // persistence best-effort
      }
      return;
    }

    disabledPlugins.set(new Set(stored));
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
