import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  getPluginById,
  getPluginsByTier,
  getPluginsByCategory,
  getCorePlugins,
  getProPlugins,
} from "./registry";

describe("plugin-registry", () => {
  it("has builtin plugins", () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThanOrEqual(10);
  });

  it("has core plugins that are always on", () => {
    const core = getCorePlugins();
    expect(core.length).toBeGreaterThanOrEqual(4);
    expect(core.every((p) => p.tier === "core")).toBe(true);
  });

  it("has free community plugins", () => {
    const plugins = BUILTIN_PLUGINS.filter((p) => p.tier === "free");
    expect(plugins.length).toBeGreaterThanOrEqual(4);
  });

  it("finds plugin by id", () => {
    const plugin = getPluginById("security-suite");
    expect(plugin).toBeDefined();
    expect(plugin?.tier).toBe("free");
    expect(plugin?.category).toBe("security");
  });

  it("returns undefined for unknown id", () => {
    expect(getPluginById("nonexistent")).toBeUndefined();
  });

  it("filters by category", () => {
    const security = getPluginsByCategory("security");
    expect(security.length).toBeGreaterThanOrEqual(1);
    expect(security.every((p) => p.category === "security")).toBe(true);
  });

  it("every plugin has required fields", () => {
    for (const plugin of BUILTIN_PLUGINS) {
      expect(plugin.id).toBeTruthy();
      expect(plugin.name).toBeTruthy();
      expect(plugin.version).toBeTruthy();
      expect(plugin.description).toBeTruthy();
      expect(plugin.author).toBeTruthy();
      expect(plugin.license).toBe("Apache-2.0");
      expect(plugin.provides).toBeDefined();
    }
  });

  it("all plugins are free", () => {
    for (const plugin of BUILTIN_PLUGINS) {
      expect(plugin.pricing?.type ?? "free").toBe("free");
    }
  });
});
