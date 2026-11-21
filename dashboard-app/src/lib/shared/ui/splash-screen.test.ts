import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SplashScreen from "./splash-screen.svelte";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
const source = readFileSync(resolve("src/lib/shared/ui/splash-screen.svelte"), "utf8");

// A screenshot of the splash tells which build a user runs. The version comes from the
// build (package.json, set by the release bump), never from a literal in the component.
describe("splash screen version", () => {
  it("shows the app version under the tags", () => {
    render(SplashScreen);
    expect(screen.getByTestId("splash-version").textContent).toBe(`v${pkg.version}`);
  });

  it("does not hardcode a version", () => {
    expect(source).toContain("__APP_VERSION__");
    expect(source).not.toMatch(/v?\d+\.\d+\.\d+/);
  });
});
