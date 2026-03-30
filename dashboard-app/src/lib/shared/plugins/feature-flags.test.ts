import { describe, expect, it, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  isPluginActive,
  isFeatureAvailable,
  disabledPlugins,
  pluginLicenses,
} from "./feature-flags";
import type { PluginManifest, PluginLicense } from "./types";

vi.mock("$shared/store", () => ({
  storeManager: {
    getStore: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

const corePlugin: PluginManifest = {
  id: "test-core",
  name: "Core",
  version: "1.0",
  description: "",
  author: "Test",
  tier: "core",
  category: "developer-tools",
  license: "Apache-2.0",
  provides: {},
};

const freePlugin: PluginManifest = {
  id: "test-free",
  name: "Free",
  version: "1.0",
  description: "",
  author: "Test",
  tier: "free",
  category: "developer-tools",
  license: "Apache-2.0",
  provides: {},
};

const proPlugin: PluginManifest = {
  id: "test-pro",
  name: "Pro",
  version: "1.0",
  description: "",
  author: "Test",
  tier: "pro",
  category: "security",
  license: "Apache-2.0",
  pricing: { type: "monthly", amount: 9, currency: "USD", trialDays: 14 },
  provides: { analysisModules: ["test-module"] },
};

describe("feature-flags", () => {
  beforeEach(() => {
    disabledPlugins.set(new Set());
    pluginLicenses.set({});
  });

  it("core plugins always active", () => {
    expect(isPluginActive(corePlugin)).toBe(true);
  });

  it("core plugins active even when disabled", () => {
    disabledPlugins.set(new Set(["test-core"]));
    expect(isPluginActive(corePlugin)).toBe(true);
  });

  it("free plugins active by default", () => {
    expect(isPluginActive(freePlugin)).toBe(true);
  });

  it("free plugins can be disabled", () => {
    disabledPlugins.set(new Set(["test-free"]));
    expect(isPluginActive(freePlugin)).toBe(false);
  });

  it("pro plugins active during trial", () => {
    expect(isPluginActive(proPlugin)).toBe(true);
  });

  it("pro plugins active with valid license", () => {
    const license: PluginLicense = {
      pluginId: "test-pro",
      tier: "pro",
      valid: true,
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    pluginLicenses.set({ "test-pro": license });
    expect(isPluginActive(proPlugin)).toBe(true);
  });

  it("pro plugins inactive with expired license", () => {
    const license: PluginLicense = {
      pluginId: "test-pro",
      tier: "pro",
      valid: true,
      activatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    pluginLicenses.set({ "test-pro": license });
    expect(isPluginActive(proPlugin)).toBe(false);
  });

  it("isFeatureAvailable checks plugin tier", () => {
    expect(isFeatureAvailable("helmcatalog")).toBe(true);
  });

  it("unknown features default to available", () => {
    expect(isFeatureAvailable("nonexistent-feature")).toBe(true);
  });
});
