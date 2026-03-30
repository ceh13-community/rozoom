import { describe, expect, it } from "vitest";
import {
  APP_THEME_LABELS,
  APP_THEME_ORDER,
  APP_THEME_STORAGE_KEY,
  buildThemeBootstrapScript,
  detectThemeFromDom,
  getNextTheme,
  getThemeDefinition,
  getThemeLabel,
  isAppTheme,
  listAppThemes,
  resolveTheme,
} from "./theme";

describe("theme registry", () => {
  it("keeps all theme metadata in sync", () => {
    const themes = listAppThemes();

    expect(themes.map((theme) => theme.id)).toEqual(APP_THEME_ORDER);
    expect(APP_THEME_LABELS.k9s).toBe("K9s");
    expect(getThemeLabel("dark")).toBe("Dark");
    expect(getThemeDefinition("k9s").rootClassName).toBe("k9s");
  });

  it("resolves and cycles themes from the registry", () => {
    expect(isAppTheme("k9s")).toBe(true);
    expect(isAppTheme("solarized")).toBe(false);
    expect(resolveTheme("solarized")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(getNextTheme("light")).toBe("dark");
    expect(getNextTheme("dark")).toBe("k9s");
    expect(getNextTheme("k9s")).toBe("light");
  });

  it("detects active themes from root classes", () => {
    const k9sRoot = document.createElement("html");
    k9sRoot.classList.add("dark", "k9s");
    expect(detectThemeFromDom(k9sRoot)).toBe("k9s");

    const darkRoot = document.createElement("html");
    darkRoot.classList.add("dark");
    expect(detectThemeFromDom(darkRoot)).toBe("dark");

    const lightRoot = document.createElement("html");
    expect(detectThemeFromDom(lightRoot)).toBe("light");
  });

  it("builds a bootstrap script that references the theme registry", () => {
    const script = buildThemeBootstrapScript();

    expect(script).toContain(APP_THEME_STORAGE_KEY);
    expect(script).toContain('"id":"k9s"');
    expect(script).toContain('root.classList.toggle("dark"');
    expect(script).toContain(
      "root.classList.remove(...themes.map((item) => item.rootClassName).filter(Boolean))",
    );
  });
});
