import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tauri compiles the web inspector into release builds only when the `tauri` crate is built
// with its `devtools` Cargo feature. Debug builds get the inspector without it.
const cargoToml = readFileSync(path.resolve(__dirname, "../src-tauri/Cargo.toml"), "utf8");

describe("release builds ship without the web inspector", () => {
  it("builds the tauri crate without the devtools feature", () => {
    const tauriDependency = cargoToml.split("\n").find((line) => /^tauri\s*=/.test(line.trim()));

    expect(tauriDependency).toBeDefined();
    expect(tauriDependency).not.toMatch(/["']devtools["']/);
  });
});
