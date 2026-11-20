import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction: vi.fn(async () => true) }));

import ShellWindow from "./shell-window.svelte";

const pod = {
  metadata: { name: "web", namespace: "shop" },
  spec: { containers: [{ name: "app" }] },
} as never;

describe("pod session window line under the title", () => {
  it("says how Shell runs commands and names the container", async () => {
    render(ShellWindow, {
      props: {
        windowState: { id: "s1", clusterId: "c1", targetPod: pod, podSessionMode: "exec" },
        windowIndex: 0,
      },
    });

    expect(await screen.findByTestId("pod-session-line")).toHaveTextContent(
      "Each command runs as a new process in container app.",
    );
  });

  it("shows no pod line in the cluster terminal", () => {
    render(ShellWindow, {
      props: { windowState: { id: "s2", clusterId: "c1", targetPod: null }, windowIndex: 0 },
    });

    expect(screen.queryByTestId("pod-session-line")).toBeNull();
  });
});
