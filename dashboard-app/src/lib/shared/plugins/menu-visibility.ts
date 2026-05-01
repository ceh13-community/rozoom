/**
 * Maps sidebar menu keys to their owning plugin so the Marketplace toggle
 * can hide/show items reactively. Core K8s primitives (Pods, Deployments,
 * Namespaces, etc.) are intentionally absent - they are not plugin-gated.
 *
 * The registry is the source of truth: each plugin manifest declares which
 * workloadPages it owns, and this helper inverts that mapping at module
 * load time so the menu filter is O(1) per key.
 */

import { derived, type Readable } from "svelte/store";
import { BUILTIN_PLUGINS, getPluginById } from "./registry";
import { disabledPlugins } from "./feature-flags";
import type { PluginManifest } from "./types";

function buildKeyToPluginIndex(): Map<string, PluginManifest> {
  const index = new Map<string, PluginManifest>();
  for (const plugin of BUILTIN_PLUGINS) {
    for (const page of plugin.provides.workloadPages ?? []) {
      // First-writer wins. If two plugins claim the same page id that is a
      // registry bug, not a runtime concern - the menu still renders.
      if (!index.has(page.id)) index.set(page.id, plugin);
    }
  }
  return index;
}

const KEY_TO_PLUGIN = buildKeyToPluginIndex();

/**
 * The plugin that owns a given menu key, or undefined when the key is not
 * plugin-gated (always visible, e.g. Pods, Namespaces, Nodes).
 */
export function pluginForMenuKey(key: string): PluginManifest | undefined {
  return KEY_TO_PLUGIN.get(key);
}

/**
 * Visibility check used by the sidebar. Items with no owning plugin always
 * show. Items owned by a core plugin always show. Otherwise visibility
 * follows the `disabledPlugins` store - if the plugin is in the disabled
 * set, its pages disappear from the sidebar.
 *
 * Pure function over an explicit disabled set so it is trivial to unit test
 * without a store mock.
 */
export function isMenuKeyVisible(key: string, disabled: ReadonlySet<string>): boolean {
  const plugin = KEY_TO_PLUGIN.get(key);
  if (!plugin) return true;
  if (plugin.tier === "core") return true;
  return !disabled.has(plugin.id);
}

/**
 * Svelte-readable visibility map keyed by menu key. Subscribes to the
 * `disabledPlugins` store so the sidebar re-renders when the user toggles
 * a plugin in the marketplace.
 */
export const menuVisibility: Readable<Map<string, boolean>> = derived(
  disabledPlugins,
  (disabled) => {
    const map = new Map<string, boolean>();
    for (const [key] of KEY_TO_PLUGIN) {
      map.set(key, isMenuKeyVisible(key, disabled));
    }
    return map;
  },
);

/**
 * Count of togglable plugins the user has turned off. Powers the
 * "N disabled" hint next to the Plugin Marketplace entry.
 */
export const disabledPluginsCount: Readable<number> = derived(disabledPlugins, (disabled) => {
  let n = 0;
  for (const id of disabled) {
    const plugin = getPluginById(id);
    if (plugin && plugin.tier !== "core") n += 1;
  }
  return n;
});

/**
 * Pages that will disappear from the sidebar when the given plugin is
 * disabled. Used by the Marketplace confirm dialog to tell the user
 * exactly what they are about to lose before flipping the switch.
 */
export function pagesHiddenByDisabling(pluginId: string): Array<{
  key: string;
  label: string;
  section: string;
}> {
  const plugin = getPluginById(pluginId);
  if (!plugin) return [];
  return (plugin.provides.workloadPages ?? []).map((p) => ({
    key: p.id,
    label: p.label,
    section: p.section,
  }));
}
