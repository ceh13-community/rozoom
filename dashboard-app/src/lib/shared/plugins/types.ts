/**
 * ROZOOM Plugin System - Type definitions.
 *
 * Plugins extend ROZOOM with new features, pages, health checks,
 * and integrations. Each plugin is a self-contained module with
 * a manifest describing its capabilities and requirements.
 *
 * Tiers:
 *   - core: always available, cannot be disabled
 *   - free: included in free tier, can be disabled
 *   - pro: requires active subscription
 *   - community: third-party plugins from marketplace
 */

export type PluginTier = "core" | "free" | "pro" | "community";

export type PluginCategory =
  | "security"
  | "observability"
  | "capacity"
  | "networking"
  | "gitops"
  | "auth"
  | "compliance"
  | "cost"
  | "developer-tools";

export type PluginStatus = "active" | "inactive" | "error" | "update-available";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tier: PluginTier;
  category: PluginCategory;
  icon?: string;
  homepage?: string;
  repository?: string;
  license: string;
  minAppVersion?: string;
  keywords?: string[];
  provides: PluginCapabilities;
  pricing?: PluginPricing;
};

export type PluginCapabilities = {
  workloadPages?: PluginPage[];
  healthChecks?: string[];
  helmCharts?: string[];
  analysisModules?: string[];
  dashboardWidgets?: string[];
};

export type PluginPage = {
  id: string;
  label: string;
  section: "cluster-ops" | "security" | "observability" | "custom";
  description: string;
};

export type PluginPricing = {
  type: "free" | "one-time" | "monthly" | "yearly";
  amount?: number;
  currency?: string;
  trialDays?: number;
};

export type PluginLicense = {
  pluginId: string;
  licenseKey?: string;
  activatedAt?: string;
  expiresAt?: string;
  tier: PluginTier;
  valid: boolean;
};

export type InstalledPlugin = {
  manifest: PluginManifest;
  status: PluginStatus;
  installedAt: string;
  license?: PluginLicense;
  config?: Record<string, unknown>;
};
