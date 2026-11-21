import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// finalize-release-asset-names.sh against a fake `gh` that keeps the draft's assets in a
// JSON file. The case: a second release run into the same draft (RC2 after RC1) finds the
// first run's `_full-offline` assets next to the fresh unsuffixed ones. GitHub refuses a
// rename onto an existing name (HTTP 422); the fake does the same.
const SCRIPT = path.resolve(__dirname, "finalize-release-asset-names.sh");

const FAKE_GH = readFileSync(path.resolve(__dirname, "testdata/fake-gh-release.sh"), "utf8");

const BASE = "https://github.com/o/r/releases/download/app-v1.0.0";
const FULL = {
  deb: "ROZOOM_1.0.0_amd64.deb",
  rpm: "ROZOOM-1.0.0-1.x86_64.rpm",
  dmg: "ROZOOM_aarch64.app.tar.gz",
  msi: "ROZOOM_1.0.0_x64_en-US.msi",
};
const fullOffline = (name: string) =>
  name
    .replace("_amd64.deb", "_amd64_full-offline.deb")
    .replace(".x86_64.rpm", ".x86_64_full-offline.rpm")
    .replace(".app.tar.gz", "_full-offline.app.tar.gz")
    .replace("_x64_en-US.msi", "_x64_full-offline_en-US.msi");

function manifest(names: typeof FULL) {
  return JSON.stringify({
    version: "1.0.0",
    platforms: {
      "linux-x86_64-deb": { url: `${BASE}/${names.deb}`, signature: "s" },
      "linux-x86_64-rpm": { url: `${BASE}/${names.rpm}`, signature: "s" },
      "darwin-aarch64": { url: `${BASE}/${names.dmg}`, signature: "s" },
      "windows-x86_64": { url: `${BASE}/${names.msi}`, signature: "s" },
    },
  });
}

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function runFinalize(assets: Array<{ id: number; name: string }>) {
  dir = mkdtempSync(path.join(tmpdir(), "finalize-"));
  const bin = path.join(dir, "bin");
  const files = path.join(dir, "files");
  execFileSync("mkdir", ["-p", bin, files]);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  const state = path.join(dir, "assets.json");
  writeFileSync(state, JSON.stringify(assets));
  writeFileSync(path.join(files, "latest.json"), manifest(FULL));
  const slim = {
    deb: "ROZOOM_1.0.0_amd64_slim.deb",
    rpm: "ROZOOM-1.0.0-1.x86_64_slim.rpm",
    dmg: "ROZOOM_aarch64_slim.app.tar.gz",
    msi: "ROZOOM_1.0.0_x64_slim_en-US.msi",
  };
  writeFileSync(path.join(files, "latest-slim.json"), manifest(slim));
  const log = path.join(dir, "gh.log");
  writeFileSync(log, "");
  const output = execFileSync("bash", [SCRIPT, "app-v1.0.0"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "o/r",
      FAKE_GH_STATE: state,
      FAKE_GH_LOG: log,
      FAKE_GH_FILES: files,
    },
    encoding: "utf8",
  });
  return {
    output,
    finalNames: (JSON.parse(readFileSync(state, "utf8")) as Array<{ name: string }>).map(
      (asset) => asset.name,
    ),
    latest: readFileSync(path.join(files, "latest.json"), "utf8"),
  };
}

const slimAssets = [
  "ROZOOM_1.0.0_amd64_slim.deb",
  "ROZOOM-1.0.0-1.x86_64_slim.rpm",
  "ROZOOM_aarch64_slim.app.tar.gz",
  "ROZOOM_1.0.0_x64_slim_en-US.msi",
  "latest.json",
  "latest-slim.json",
];

describe("finalize-release-asset-names.sh", () => {
  it("renames a fresh draft's full assets to _full-offline", () => {
    const assets = [...Object.values(FULL), ...slimAssets].map((name, index) => ({
      id: index + 1,
      name,
    }));
    const { output, finalNames, latest } = runFinalize(assets);
    expect(output).toContain("release app-v1.0.0 finalized");
    for (const name of Object.values(FULL)) {
      expect(finalNames).toContain(fullOffline(name));
      expect(latest).toContain(fullOffline(name));
    }
  });

  it("replaces the previous run's _full-offline assets in a reused draft", () => {
    const fresh = Object.values(FULL).map((name, index) => ({ id: 100 + index, name }));
    const stale = Object.values(FULL).map((name, index) => ({
      id: 200 + index,
      name: fullOffline(name),
    }));
    const others = slimAssets.map((name, index) => ({ id: 300 + index, name }));
    const { output, finalNames } = runFinalize([...stale, ...fresh, ...others]);
    expect(output).toContain("release app-v1.0.0 finalized");
    expect(output).toContain(`deleted older asset: ${fullOffline(FULL.deb)} (id 200)`);
    // One copy of each full-offline asset, and it is the fresh build (ids 100+).
    for (const name of Object.values(FULL)) {
      expect(finalNames.filter((n) => n === fullOffline(name))).toHaveLength(1);
      expect(finalNames).not.toContain(name);
    }
    const state = JSON.parse(readFileSync(path.join(dir, "assets.json"), "utf8")) as Array<{
      id: number;
      name: string;
    }>;
    expect(state.filter((asset) => asset.id >= 200 && asset.id < 300)).toHaveLength(0);
  });
});
