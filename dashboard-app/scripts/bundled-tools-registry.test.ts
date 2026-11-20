import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(appDir, file), "utf8");

const downloader = read("download-binaries.js");
const sidecarBlock = /const SIDECAR_TOOLS = \[([\s\S]*?)\];/.exec(downloader)?.[1] ?? "";
const sidecarTools = [...sidecarBlock.matchAll(/"([a-z0-9-]+)"/g)].map(([, name]) => name);

const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  bundle: { externalBin: string[] };
};
const capability = read("src-tauri/capabilities/default.json");
const tooling = read("src/lib/shared/config/tooling.ts");
const licenses = JSON.parse(read("../third-party/tools.json")) as {
  tools: Record<string, unknown>;
};

// A sidecar needs five entries to work and ship legally: the downloader, the bundle, the
// shell permission, the tool registry the Terminal and status checks read, and the
// third-party licenses table. Missing one breaks the tool at run time or the release gate.
describe("bundled sidecar tools", () => {
  it("finds the sidecar list in download-binaries.js", () => {
    expect(sidecarTools).toContain("kubectl");
    expect(sidecarTools).toContain("jq");
  });

  it.each(sidecarTools)("%s is bundled, allowed, registered and licensed", (tool) => {
    expect(tauriConfig.bundle.externalBin).toContain(`binaries/rozoom-${tool}`);
    expect(capability).toContain(`"name": "binaries/rozoom-${tool}"`);
    expect(tooling).toContain(`tool: "${tool}"`);
    expect(Object.keys(licenses.tools)).toContain(tool);
  });

  it("downloads jq from its own releases with a checksum", () => {
    expect(downloader).toContain('await run("jq", installJq);');
    expect(downloader).toMatch(/name: "jq",\s*repo: "jqlang\/jq"/);
    expect(downloader).not.toMatch(/name: "jq",[\s\S]{0,200}skipChecksumAsset: true/);
  });
});
