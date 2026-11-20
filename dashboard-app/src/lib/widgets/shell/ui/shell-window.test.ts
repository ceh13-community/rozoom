import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
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

  it("stops the network debug container when the window unmounts without explicit close", async () => {
    const stopArgs = ["exec", "-i", "--namespace", "shop", "-c", "rozoom-netshoot-abc123", "web-a"];
    const { unmount } = render(ShellWindow, {
      props: {
        windowState: {
          id: "shell-2",
          clusterId: "cluster-a",
          targetPod: { metadata: { name: "web-a", namespace: "shop" } },
          podSessionMode: "exec",
          targetContainer: "rozoom-netshoot-abc123",
          stopArgs,
          sessionKind: "pod-network-debug",
          openedAt: Date.now(),
        },
        windowIndex: 0,
      },
    });

    unmount();

    await waitFor(() => {
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(stopArgs, { clusterId: "cluster-a" });
    });
  });

  it("runs commands in the session's debug container, not the app container", async () => {
    kubectlRawArgsFront.mockResolvedValue({ output: "10.96.0.1", errors: "", code: 0 });
    render(ShellWindow, {
      props: {
        windowState: {
          id: "shell-3",
          clusterId: "cluster-a",
          targetPod: {
            metadata: { name: "web-a", namespace: "shop" },
            spec: { containers: [{ name: "nginx" }] },
          } as never,
          podSessionMode: "exec",
          targetContainer: "rozoom-netshoot-abc123",
          stopArgs: ["exec"],
          sessionKind: "pod-network-debug",
          openedAt: Date.now(),
        },
        windowIndex: 0,
      },
    });

    const input = await screen.findByPlaceholderText(/Run command inside the selected pod/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await fireEvent.input(input, { target: { value: "dig +short kubernetes.default" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        [
          "exec",
          "-i",
          "--namespace",
          "shop",
          "-c",
          "rozoom-netshoot-abc123",
          "web-a",
          "--",
          "sh",
          "-lc",
          "dig +short kubernetes.default",
        ],
        { clusterId: "cluster-a" },
      );
    });
  });
});
