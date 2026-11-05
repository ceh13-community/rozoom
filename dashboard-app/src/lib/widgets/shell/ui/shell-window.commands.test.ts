import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDebugDescribe } from "$features/resource-debug-runtime/model/debug-describe";
import { closeAllShellModals, shellModalState } from "$features/shell";
import ShellWindow from "./shell-window.svelte";

const cli = vi.hoisted(() => ({
  execCliForCluster: vi.fn(async () => ({ code: 0, stdout: "described", stderr: "" })),
  execShellCommand: vi.fn(async () => ({ code: 0, stdout: "listed", stderr: "" })),
}));

vi.mock("$shared/api/cli", () => cli);
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction: vi.fn(async () => true) }));

function renderDebugTerminal() {
  return render(ShellWindow, {
    props: {
      windowState: {
        id: "shell-1",
        clusterId: "cluster-a",
        targetPod: null,
        sessionKind: "debug-shell",
        openedAt: Date.now(),
      },
      windowIndex: 0,
    },
  });
}

async function typeAndRun(command: string) {
  const input = await screen.findByPlaceholderText(/Type command/);
  await waitFor(() => expect(input).not.toBeDisabled());
  await fireEvent.input(input, { target: { value: command } });
  await fireEvent.keyDown(input, { key: "Enter" });
}

describe("shell window command execution", () => {
  beforeEach(() => {
    cli.execCliForCluster.mockClear();
    cli.execShellCommand.mockClear();
    closeAllShellModals();
  });

  it.each([
    ["an unbalanced quote", "a;touch marker;#'"],
    ["a trailing backslash", "ends-with-backslash\\"],
    ["a command substitution", "$(touch marker)"],
    ["a space", "two words"],
    ["a leading dash", "--all"],
  ])("runs debug describe as one argument when the name has %s", async (_label, name) => {
    runDebugDescribe({ clusterId: "cluster-a", resource: "roles", name, namespace: "team" });
    const windowState = get(shellModalState).at(-1);
    if (!windowState) throw new Error("no shell window was opened");

    render(ShellWindow, { props: { windowState, windowIndex: 0 } });

    await waitFor(() => {
      expect(cli.execCliForCluster).toHaveBeenCalledWith(
        "kubectl",
        ["describe", "roles", "-n", "team", "--", name],
        "cluster-a",
      );
    });
    expect(cli.execShellCommand).not.toHaveBeenCalled();
  });

  it("refuses a typed command that cannot be parsed", async () => {
    renderDebugTerminal();

    await typeAndRun("kubectl describe roles it's");

    await screen.findAllByText(/Not run: Unterminated single-quoted string/);
    expect(cli.execShellCommand).not.toHaveBeenCalled();
    expect(cli.execCliForCluster).not.toHaveBeenCalled();
  });

  it("passes a typed Windows path to cmd instead of refusing it", async () => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    renderDebugTerminal();

    await typeAndRun("dir C:\\Users\\");

    await waitFor(() => {
      expect(cli.execShellCommand).toHaveBeenCalledWith("dir C:\\Users\\");
    });
    platform.mockRestore();
  });

  it("still runs a typed bundled tool directly", async () => {
    renderDebugTerminal();

    await typeAndRun("kubectl get ns");

    await waitFor(() => {
      expect(cli.execCliForCluster).toHaveBeenCalledWith("kubectl", ["get", "ns"], "cluster-a");
    });
    expect(cli.execShellCommand).not.toHaveBeenCalled();
  });

  it("still passes other typed commands to the platform shell", async () => {
    renderDebugTerminal();

    await typeAndRun("ls -la | wc -l");

    await waitFor(() => {
      expect(cli.execShellCommand).toHaveBeenCalledWith("ls -la | wc -l");
    });
    expect(cli.execCliForCluster).not.toHaveBeenCalled();
  });
});
