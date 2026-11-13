import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

// The logger and the boundary only help if they are wired in. Both live in files that
// unit tests do not render (the client hook and the dashboard layout).
describe("JS error capture wiring", () => {
  it("the client hook installs the global error logging", () => {
    expect(read("src/hooks.client.ts")).toMatch(/^installGlobalErrorLogging\(\);$/m);
  });

  it("every page slot of the dashboard layout sits inside the render error boundary", () => {
    const layout = read("src/routes/dashboard/+layout.svelte");
    const slots = layout.match(/\{@render children\(\)\}/g) ?? [];
    const guarded =
      layout.match(/<RenderErrorBoundary>\s*\{@render children\(\)\}\s*<\/RenderErrorBoundary>/g) ??
      [];
    expect(slots.length).toBeGreaterThan(0);
    expect(guarded).toHaveLength(slots.length);
  });
});
