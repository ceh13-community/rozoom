import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.1 AA: text 4.5:1, borders of fields and controls 3:1 (1.4.11).
const css = readFileSync(resolve(__dirname, "index.css"), "utf8");

function themeTokens(selector: string): Record<string, [number, number, number]> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, [number, number, number]> = {};
  for (const [, name, h, s, l] of block.matchAll(
    /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/g,
  )) {
    tokens[name] = [Number(h), Number(s), Number(l)];
  }
  return tokens;
}

function hslToRgb([h, s, l]: [number, number, number]) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(color: [number, number, number]) {
  const [r, g, b] = hslToRgb(color).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { Light: ":root", Dark: ".dark", K9s: ".k9s" } as const;

describe.each(Object.entries(THEMES))("%s theme tokens", (_theme, selector) => {
  const t = themeTokens(selector);

  it.each([
    ["foreground on background", "foreground", "background"],
    ["muted text on background", "muted-foreground", "background"],
    ["button text on primary", "primary-foreground", "primary"],
    ["text on destructive", "destructive-foreground", "destructive"],
  ])("%s reaches 4.5:1", (_pair, fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("field borders reach 3:1 against the background", () => {
    expect(contrast(t.input, t.background)).toBeGreaterThanOrEqual(3);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("muted text", () => {
  // Muted text below /90 opacity drops under 4.5:1 in at least one theme.
  it("is not faded below 90% opacity", () => {
    // src/lib and src/routes: the error page lives in routes.
    const faded = [resolve(__dirname, "../.."), resolve(__dirname, "../../../routes")]
      .flatMap(sourceFiles)
      .filter((file) => /text-muted-foreground\/[1-8]\d?\b/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(file.indexOf("src/")));
    expect(faded).toEqual([]);
  });
});

describe("Workload Map", () => {
  // It was drawn in fixed dark slate colours: on the light theme the subtitle, the filters
  // and the kind chips were close to invisible. It follows the app theme now.
  it("uses theme colours, and dark variants for its light kind colours", () => {
    const panel = readFileSync(
      resolve(
        __dirname,
        "../../shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte",
      ),
      "utf8",
    );
    expect(panel).not.toMatch(/slate-/);
    const lightOnly = [...panel.matchAll(/(?<!dark:)text-[a-z]+-(200|300|400)\b/g)].map(
      (m) => m[0],
    );
    expect(lightOnly).toEqual([]);
  });
});

describe("K9s overrides", () => {
  it("set no font size below 12 px", () => {
    const k9s = readFileSync(resolve(__dirname, "themes/k9s.css"), "utf8");
    const sizes = [...k9s.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)].map(([, value, unit]) =>
      unit === "rem" ? Number(value) * 16 : Number(value),
    );
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });

  it("draw field borders with the input token, not a faded colour", () => {
    const k9s = readFileSync(resolve(__dirname, "themes/k9s.css"), "utf8");
    const rule = /\.k9s \.border-input \{\s*border-color: ([^;]+);/.exec(k9s)?.[1];
    expect(rule).toBe("hsl(var(--input))");
  });
});

describe("light theme sidebar rail", () => {
  const light = readFileSync(resolve(__dirname, "themes/light.css"), "utf8");
  const railBlock = light.slice(light.indexOf(".app-sidebar-rail {"));
  const stops = [
    ...(/background: linear-gradient\(([^;]+)\);/.exec(railBlock)?.[1] ?? "").matchAll(
      /hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/g,
    ),
  ].map(([, h, s, l]) => [Number(h), Number(s), Number(l)] as [number, number, number]);

  // Toggles and Notifications used theme text colours (dark slate, blue) on the blue rail.
  it("draws toggles and notifications in white, readable on every stop of the blue", () => {
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(light).toMatch(
      /\.rail-toggle,\s*html:not\(\.dark\):not\(\.k9s\) \.app-sidebar-rail \.rail-notifications \{\s*color: hsl\(0 0% 100%\);/,
    );
    for (const stop of stops) expect(contrast([0, 0, 100], stop)).toBeGreaterThanOrEqual(4.5);
  });

  it("marks a toggle that is on with a chip, not by fading the one that is off", () => {
    expect(light).toMatch(/\.rail-toggle\[aria-pressed="true"\] \{\s*background:/);
    const sidebar = readFileSync(
      resolve(__dirname, "../../widgets/sidebar/ui/sidebar.svelte"),
      "utf8",
    );
    expect(sidebar.match(/class=\{cn\(\s*"rail-toggle /g)).toHaveLength(3);
    expect(sidebar).not.toMatch(/!cliNotificationsEnabled && "opacity-50"/);
  });
});
