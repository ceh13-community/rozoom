import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tauri compiles the web inspector into release builds only when its `devtools` Cargo feature
// is on (directly, through a feature of ours, per target, or through wry). Debug builds get the
// inspector without it. Any mention of devtools outside a comment fails, so every way of
// turning the feature on in this file is caught, not only the `tauri = ...` line.
const cargoToml = readFileSync(path.resolve(__dirname, "../src-tauri/Cargo.toml"), "utf8");

function withoutComments(toml: string): string {
  return toml
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

function enablesDevtools(toml: string): boolean {
  return /devtools/i.test(withoutComments(toml));
}

const TAURI_LINE = 'tauri = { version = "2.9", features = [] }';

describe("release builds ship without the web inspector", () => {
  it("src-tauri/Cargo.toml does not enable the devtools feature", () => {
    expect(cargoToml).toContain(TAURI_LINE);
    expect(enablesDevtools(cargoToml)).toBe(false);
  });

  it.each([
    [
      "feature on the tauri line",
      cargoToml.replace(TAURI_LINE, 'tauri = { version = "2.9", features = ["devtools"] }'),
    ],
    [
      "feature on the next line",
      cargoToml.replace(TAURI_LINE, 'tauri = { version = "2.9", features = [\n  "devtools",\n] }'),
    ],
    ["default feature of this crate", `${cargoToml}\n[features]\ndefault = ["tauri/devtools"]\n`],
    [
      "target-specific dependency",
      `${cargoToml}\n[target.'cfg(windows)'.dependencies]\ntauri = { version = "2.9", features = ["devtools"] }\n`,
    ],
    [
      "wry as a direct dependency",
      cargoToml.replace(
        "[dependencies]\n",
        '[dependencies]\nwry = { version = "0.53", features = ["devtools"] }\n',
      ),
    ],
    [
      "table form of the tauri dependency",
      `${cargoToml.replace(TAURI_LINE, "")}\n[dependencies.tauri]\nversion = "2.9"\nfeatures = ["devtools"]\n`,
    ],
  ])("catches the feature turned on as %s", (_, toml) => {
    expect(enablesDevtools(toml)).toBe(true);
  });

  it("ignores devtools mentioned only in a comment", () => {
    const commented = cargoToml.replace(TAURI_LINE, `${TAURI_LINE} # no "devtools" in release`);
    expect(enablesDevtools(commented)).toBe(false);
  });
});
