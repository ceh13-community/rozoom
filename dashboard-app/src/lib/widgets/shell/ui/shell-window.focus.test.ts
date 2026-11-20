import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction: vi.fn(async () => true) }));

import ShellWindow from "./shell-window.svelte";

// Shell opened from a row menu left keyboard focus on the menu; closing it dropped focus
// on the page body.
describe("shell window focus", () => {
  it("moves focus to the command box and back to the opener on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const view = render(ShellWindow, {
      props: {
        windowState: {
          id: "f1",
          clusterId: "c1",
          targetPod: {
            metadata: { name: "web", namespace: "shop" },
            spec: { containers: [{ name: "app" }] },
          } as never,
          podSessionMode: "exec",
        },
        windowIndex: 0,
      },
    });

    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe("TEXTAREA");
    });

    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
