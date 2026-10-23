import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-unresolved
import { buildInventory, stable } from "./surface-inventory.mjs";

const ROOT = path.resolve(__dirname, "..");

describe("surface inventory", () => {
  const inventory = buildInventory();

  it("has no structural violations", () => {
    expect(inventory.violations).toEqual([]);
  });

  it("covers the known baseline surface", () => {
    // Totals move only through an intentional surface change; the committed
    // surface-inventory.json is the single declared baseline.
    expect(inventory.totals.plugins).toBeGreaterThanOrEqual(18);
    expect(inventory.totals.screens).toBeGreaterThanOrEqual(71);
    expect(inventory.totals.actions).toBeGreaterThanOrEqual(242);
    expect(inventory.totals.orphanScreens).toBe(0);
  });

  it("matches the committed surface-inventory.json", () => {
    const committed = readFileSync(path.join(ROOT, "surface-inventory.json"), "utf8");
    expect(committed).toBe(stable(inventory));
  });

  it("classifies visibility from the plugin registry", () => {
    const byKey = new Map(inventory.screens.map((s) => [s.key, s]));
    // Core primitives are never plugin-gated.
    expect(byKey.get("pods")?.visibility).toBe("always");
    // workload-visualizer ships off by default (xBshbC8x context).
    expect(byKey.get("visualizer")?.visibility).toMatch(/plugin-gated/);
  });

  it("resolves every screen loader to an existing component", () => {
    for (const screen of inventory.screens) {
      expect(screen.component, `screen ${screen.key}`).toBeTruthy();
    }
  });
});
