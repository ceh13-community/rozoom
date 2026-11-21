import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// Services and Pods share one port-forward flow: an in-app dialog picks the ports (no
// window.prompt), then one panel shows the forward with Copy URL, Open Web, Stop, Refresh.
describe("shared port-forward panel", () => {
  const panel = read("common/port-forward-panel.svelte");

  it("starts and stops forwards and shows them in the browser tab", () => {
    expect(panel).toContain("<PortForwardDialog");
    expect(panel).toContain("startPortForward({");
    expect(panel).toContain("stopPortForward(currentKey)");
    expect(panel).toContain("<PortForwardBrowserTab");
    expect(panel).toContain("isTauriAvailable()");
  });

  it("serves the page on 127.0.0.1 and the local port, and never navigates away", () => {
    expect(panel).toContain("`${scheme}://127.0.0.1:${localPort}`");
    expect(panel).not.toContain("localhost");
    expect(panel).not.toContain("goto(");
  });

  it("uses the Network > Port Forwarding key so the forward is listed there", () => {
    expect(panel).toContain("portForwardKey(clusterId, target, localPort, remotePort)");
  });

  it.each([
    ["pods-list/pods-list.svelte", "podPortForwardTarget("],
    ["network/network-list.svelte", "servicePortForwardTarget("],
  ])("%s opens the shared panel", (file, targetBuilder) => {
    const source = read(file);
    expect(source).toContain("<PortForwardPanel");
    expect(source).toContain(targetBuilder);
  });

  it("asks without native prompts", () => {
    for (const file of [
      "common/port-forward-panel.svelte",
      "common/port-forward-dialog.svelte",
      "pods-list/pods-list.svelte",
      "network/network-list.svelte",
    ]) {
      expect(read(file)).not.toMatch(
        /window\.(prompt|alert)\(|requestPortForwardStartMode|requestLocalPort/,
      );
    }
  });
});
