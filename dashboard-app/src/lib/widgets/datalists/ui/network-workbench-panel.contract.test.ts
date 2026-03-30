import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/network/network-workbench-panel.svelte"),
  "utf8",
);

describe("network workbench panel contract", () => {
  it("owns service port-forward tooling outside the base network table", () => {
    expect(source).toContain('kind: "service-port-forward"');
    expect(source).toContain("startPortForward");
    expect(source).toContain("stopPortForward");
    expect(source).toContain("PortForwardBrowserTab");
    expect(source).toContain("isTauriAvailable");
    expect(source).toContain("Service web tooling is available only in the desktop runtime.");
  });
});
