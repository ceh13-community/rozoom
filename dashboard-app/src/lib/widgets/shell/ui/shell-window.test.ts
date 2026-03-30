import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShellWindow from "./shell-window.svelte";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront,
}));

vi.mock("$shared/lib/confirm-action", () => ({
  confirmAction: vi.fn(async () => true),
}));

describe("shell window cleanup", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
  });

  it("deletes pod debug sessions when the window unmounts without explicit close", async () => {
    const { unmount } = render(ShellWindow, {
      props: {
        windowState: {
          id: "shell-1",
          clusterId: "cluster-a",
          targetPod: {
            metadata: {
              name: "debug-copy-api-123",
              namespace: "prod",
            },
          },
          podSessionMode: "exec",
          cleanupPod: {
            name: "debug-copy-api-123",
            namespace: "prod",
          },
          sessionKind: "pod-debug",
          openedAt: Date.now(),
        },
        windowIndex: 0,
      },
    });

    unmount();

    await waitFor(() => {
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        [
          "delete",
          "pod",
          "debug-copy-api-123",
          "--namespace",
          "prod",
          "--ignore-not-found=true",
          "--grace-period=0",
          "--force",
        ],
        { clusterId: "cluster-a" },
      );
    });
  });
});
