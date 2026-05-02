import { describe, expect, it } from "vitest";
import { isMenuKeyVisible, pagesHiddenByDisabling, pluginForMenuKey } from "./menu-visibility";

describe("pluginForMenuKey", () => {
  it("returns the owning plugin for a plugin-gated page id", () => {
    const plugin = pluginForMenuKey("securityaudit");
    expect(plugin?.id).toBe("security-suite");
  });

  it("returns undefined for pages not owned by any plugin", () => {
    expect(pluginForMenuKey("nodespressures")).toBeUndefined();
    expect(pluginForMenuKey("podsrestarts")).toBeUndefined();
    expect(pluginForMenuKey("metricssources")).toBeUndefined();
  });
});

describe("isMenuKeyVisible", () => {
  it("shows pages with no owning plugin regardless of disabled set", () => {
    expect(isMenuKeyVisible("nodespressures", new Set(["security-suite"]))).toBe(true);
    expect(isMenuKeyVisible("podsrestarts", new Set(["security-suite"]))).toBe(true);
  });

  it("always shows pages owned by core plugins even if somehow in the disabled set", () => {
    // helmcatalog is owned by the `helm-catalog` core plugin.
    expect(isMenuKeyVisible("helmcatalog", new Set(["helm-catalog"]))).toBe(true);
  });

  it("hides a plugin's page when the plugin is in the disabled set", () => {
    expect(isMenuKeyVisible("securityaudit", new Set(["security-suite"]))).toBe(false);
    expect(isMenuKeyVisible("capacityintelligence", new Set(["capacity-intelligence"]))).toBe(
      false,
    );
  });

  it("shows a plugin's page when the plugin is not disabled", () => {
    expect(isMenuKeyVisible("securityaudit", new Set())).toBe(true);
  });

  it("maps both visualizer and resourcemap to workload-visualizer", () => {
    const disabled = new Set(["workload-visualizer"]);
    expect(isMenuKeyVisible("visualizer", disabled)).toBe(false);
    expect(isMenuKeyVisible("resourcemap", disabled)).toBe(false);
  });
});

describe("pagesHiddenByDisabling", () => {
  it("returns every page a plugin owns", () => {
    const pages = pagesHiddenByDisabling("compliance-integrations");
    const keys = pages.map((p) => p.key).sort();
    expect(keys).toEqual(["armorhub", "compliancehub", "trivyhub"]);
  });

  it("returns pages with their human labels for the confirm dialog", () => {
    const pages = pagesHiddenByDisabling("security-suite");
    expect(pages.find((p) => p.key === "securityaudit")?.label).toBe("Security Audit");
    expect(pages.find((p) => p.key === "authsecurity")?.label).toBe("Auth & Credentials");
  });

  it("returns empty array for unknown plugin id", () => {
    expect(pagesHiddenByDisabling("does-not-exist")).toEqual([]);
  });

  it("returns empty array for plugins that provide only health checks or modules", () => {
    // health-checks (core) provides no workloadPages.
    expect(pagesHiddenByDisabling("health-checks")).toEqual([]);
  });
});
