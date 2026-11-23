import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The pod port-forward tab was a strip over an empty field: no state, no connections,
// nothing from kubectl. The pane now feeds the tab from the forward's store entry, and
// the workbench takes the height of that content instead of the fixed list height.
const pane = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pod-workbench-pane.svelte"),
  "utf8",
);
const panel = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pod-workbench-panel.svelte"),
  "utf8",
);
const network = readFileSync(
  resolve("src/lib/widgets/datalists/ui/network/network-workbench-panel.svelte"),
  "utf8",
);

describe("pod port-forward tab contract", () => {
  it("the pane reads the forward by its key and passes state, log and Test to the tab", () => {
    expect(pane).toContain("{@const forward = $activePortForwards[paneTab.uniqueKey]}");
    expect(pane).toContain("status={describePortForwardState(forward)}");
    expect(pane).toContain("logLines={forward?.log ?? []}");
    expect(pane).toContain("onTest={() => testPortForwardUrl(paneTab.url)}");
  });

  it("the workbench takes the height of a port-forward tab's content", () => {
    expect(panel).toContain('activeWorkbenchTab.kind === "port-forward"');
    expect(panel).toContain('? "max-h-[min(70dvh,760px)]"');
    expect(panel).toContain(': "h-[min(70dvh,760px)] min-h-[430px]"');
  });

  it("the Services panel shows the same status line and Test", () => {
    expect(network).toContain("status={describePortForwardState(currentForward)}");
    expect(network).toContain("onTest={() => testPortForwardUrl(currentUrl)}");
  });
});
