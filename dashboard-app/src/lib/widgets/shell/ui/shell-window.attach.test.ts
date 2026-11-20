import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => ({
  startPodOutputStream: vi.fn(),
  stop: vi.fn(async () => undefined),
}));
vi.mock("$widgets/shell/model/pod-output-stream", () => ({
  startPodOutputStream: stream.startPodOutputStream,
}));
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction: vi.fn(async () => true) }));

import ShellWindow from "./shell-window.svelte";

type Callbacks = { onLine: (line: string) => void; onEnd: (code: number | null) => void };

describe("shell window in attach mode", () => {
  let callbacks: Callbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    stream.startPodOutputStream.mockImplementation(async (args: Callbacks) => {
      callbacks = args;
      return { viaLog: false, stop: stream.stop };
    });
  });

  function renderAttach() {
    return render(ShellWindow, {
      props: {
        windowState: {
          id: "attach-1",
          clusterId: "cluster-a",
          targetPod: {
            metadata: { name: "web", namespace: "shop" },
            spec: { containers: [{ name: "app" }] },
          } as never,
          podSessionMode: "attach",
          openedAt: Date.now(),
        },
        windowIndex: 0,
      },
    });
  }

  it("shows the process output read-only, without a command box", async () => {
    renderAttach();

    await waitFor(() => {
      expect(stream.startPodOutputStream).toHaveBeenCalledWith(
        expect.objectContaining({ clusterId: "cluster-a", container: "app" }),
      );
    });
    callbacks.onLine("GET / 200");

    expect(await screen.findByText("GET / 200")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("attach-read-only-note")).toHaveTextContent(/Read-only/);
  });

  it("says when the stream ended and stops kubectl when the window goes away", async () => {
    const { unmount } = renderAttach();
    await waitFor(() => expect(stream.startPodOutputStream).toHaveBeenCalled());

    callbacks.onEnd(1);
    expect(
      await screen.findByText(/The output stream ended \(kubectl exit code 1\)\./),
    ).toBeInTheDocument();
    expect(screen.getByTestId("attach-read-only-note")).toHaveTextContent(/open Attach again/);

    unmount();
    expect(stream.stop).not.toHaveBeenCalled();
  });

  it("stops the running stream on unmount", async () => {
    const { unmount } = renderAttach();
    await waitFor(() => expect(stream.startPodOutputStream).toHaveBeenCalled());
    await Promise.resolve();

    unmount();
    expect(stream.stop).toHaveBeenCalledTimes(1);
  });
});
