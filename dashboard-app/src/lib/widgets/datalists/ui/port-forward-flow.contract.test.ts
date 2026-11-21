import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// Pods and Services start a port-forward the same way: the in-app dialog picks the ports,
// then a workbench tab shows the forward with the same PortForwardBrowserTab (Copy URL,
// Open Web, Open external, Stop). No window.prompt on either page.
describe("port-forward flow on Pods and Services", () => {
  const pods = read("pods-list/pods-list.svelte");
  const workbench = read("pods-list/pod-workbench-panel.svelte");
  const pane = read("pods-list/pod-workbench-pane.svelte");
  const services = read("configuration-list.svelte");

  it("asks for the ports in the shared dialog on both pages", () => {
    expect(pods).toContain("<PortForwardDialog");
    expect(pods).toContain("podPortForwardTarget(");
    expect(services).toContain("<PortForwardDialog");
    expect(services).toContain("servicePortForwardTarget(");
  });

  it("starts the pod forward on the chosen ports with the Network > Port Forwarding key", () => {
    expect(pods).toContain(
      "portForwardKey(data.slug, target, choice.localPort, choice.remotePort)",
    );
    expect(pods).toMatch(/remotePort: choice\.remotePort,\s*localPort: choice\.localPort,/);
    expect(pods).toContain('kind: "port-forward"');
    expect(pods).toContain("`${choice.scheme}://127.0.0.1:${choice.localPort}`");
  });

  it("shows a pod forward in a workbench tab with the Service panel", () => {
    expect(pane).toContain('paneTab.kind === "port-forward"');
    expect(pane).toContain("<PortForwardBrowserTab");
    expect(services).toContain("<PortForwardBrowserTab");
    expect(workbench).toContain("openPortForwardForPod(pod, request.portForwardKey)");
  });

  it("stops the forward when its tab closes and closes the tab when the forward stops", () => {
    expect(workbench).toContain('stopsPortForward: closingTab.kind === "port-forward"');
    expect(workbench).toContain("await stopPortForward(closingPortForward.uniqueKey)");
    expect(workbench).toContain("!forwards[tab.uniqueKey]?.isRunning");
  });

  it("does not save port-forward tabs with the workbench", () => {
    expect(workbench).toContain("/^(logs|yaml|events):([^/]+)\\/(.+)$/");
  });

  it("uses no native prompts", () => {
    for (const source of [pods, workbench, services]) {
      expect(source).not.toMatch(/window\.prompt\(|requestPortForwardStartMode|requestLocalPort/);
    }
  });
});
