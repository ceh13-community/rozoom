export type {
  PluginManifest,
  PluginTier,
  PluginCategory,
  PluginStatus,
  PluginCapabilities,
  PluginPricing,
  PluginLicense,
  InstalledPlugin,
  PluginPage,
} from "./types";

export {
  BUILTIN_PLUGINS,
  getPluginById,
  getPluginsByTier,
  getPluginsByCategory,
  getCorePlugins,
  getProPlugins,
} from "./registry";

export {
  pluginLicenses,
  disabledPlugins,
  loadPluginState,
  saveLicense,
  togglePlugin,
  isPluginActive,
  getTrialDaysRemaining,
  getInstalledPlugins,
  isFeatureAvailable,
} from "./feature-flags";

export {
  disabledPluginsCount,
  isMenuKeyVisible,
  menuVisibility,
  pagesHiddenByDisabling,
  pluginForMenuKey,
} from "./menu-visibility";
