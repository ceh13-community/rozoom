import { describe, expect, it } from "vitest";
import { YAML_SYNTAX_PALETTES, yamlSyntaxHighlight, isDarkEditorTheme } from "./yaml-editor-theme";
import type { AppTheme } from "$shared/theme";

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------

// --background values per theme, mirrored from src/lib/app/styles/index.css
const THEME_BACKGROUNDS: Record<AppTheme, [number, number, number]> = {
  light: [210, 100, 99],
  dark: [222, 47, 7],
  k9s: [0, 0, 2],
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const THEMES = Object.keys(YAML_SYNTAX_PALETTES) as AppTheme[];

describe("YAML syntax palettes", () => {
  it("defines a palette for every app theme", () => {
    expect(THEMES.sort()).toEqual(["dark", "k9s", "light"]);
  });

  describe.each(THEMES)("%s palette", (theme) => {
    const background = hslToRgb(...THEME_BACKGROUNDS[theme]);

    it.each(Object.entries(YAML_SYNTAX_PALETTES[theme]))(
      "%s color meets WCAG AA (4.5:1) against the theme background",
      (_token, color) => {
        expect(contrastRatio(hexToRgb(color), background)).toBeGreaterThanOrEqual(4.5);
      },
    );
  });

  it("uses an amber keyword tone for k9s instead of the dark blue", () => {
    expect(YAML_SYNTAX_PALETTES.k9s.keyword).not.toBe(YAML_SYNTAX_PALETTES.dark.keyword);
  });
});

describe("yamlSyntaxHighlight", () => {
  it("returns a stable instance per theme", () => {
    for (const theme of THEMES) {
      expect(yamlSyntaxHighlight(theme)).toBe(yamlSyntaxHighlight(theme));
    }
    expect(yamlSyntaxHighlight("light")).not.toBe(yamlSyntaxHighlight("dark"));
  });
});

describe("isDarkEditorTheme", () => {
  it("marks only light as non-dark", () => {
    expect(isDarkEditorTheme("light")).toBe(false);
    expect(isDarkEditorTheme("dark")).toBe(true);
    expect(isDarkEditorTheme("k9s")).toBe(true);
  });
});
