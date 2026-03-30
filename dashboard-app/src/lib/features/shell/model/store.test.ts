import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import {
  closeAllShellModals,
  closeShellModal,
  focusShellModal,
  openDebugDescribeModal,
  openPodAttachModal,
  openPodDebugShellModal,
  openPodShellModal,
  openShellModal,
  shellModalState,
} from "./store";

describe("shell window store", () => {
  beforeEach(() => {
    closeAllShellModals();
  });

  it("opens debug, exec, debug-pod and attach windows with expected session modes", () => {
    openShellModal("c-1");
    openDebugDescribeModal("c-1", {
      initialCommand: "kubectl describe pod api-0 -n default",
      sessionLabel: "Describe pod default/api-0",
      targetNamespace: "default",
    });
    openPodShellModal("c-1", { metadata: { name: "pod-a", namespace: "ns-a" } });
    openPodDebugShellModal(
      "c-1",
      { metadata: { name: "debug-copy-api", namespace: "ns-a" } },
      {
        cleanupPod: { name: "debug-copy-api", namespace: "ns-a" },
        sessionLabel: "Debug session ns-a/api",
      },
    );
    openPodAttachModal("c-1", { metadata: { name: "pod-b", namespace: "ns-b" } });

    const state = get(shellModalState);
    expect(state).toHaveLength(5);
    expect(state[0]?.targetPod).toBeNull();
    expect(state[0]?.sessionKind).toBe("debug-shell");
    expect(state[1]?.sessionKind).toBe("debug-describe");
    expect(state[1]?.initialCommand).toContain("kubectl describe pod api-0");
    expect(typeof state[1]?.openedAt).toBe("number");
    expect(state[2]?.podSessionMode).toBe("exec");
    expect(state[3]?.sessionKind).toBe("pod-debug");
    expect(state[3]?.cleanupPod?.name).toBe("debug-copy-api");
    expect(state[4]?.podSessionMode).toBe("attach");
  });

  it("moves focused window to the top of stack", () => {
    openShellModal("c-1");
    openPodShellModal("c-1", { metadata: { name: "pod-a", namespace: "ns-a" } });
    openPodAttachModal("c-1", { metadata: { name: "pod-b", namespace: "ns-b" } });
    const initial = get(shellModalState);
    const targetId = initial[0]?.id;
    expect(targetId).toBeTruthy();

    focusShellModal(targetId!);
    const focused = get(shellModalState);

    expect(focused[focused.length - 1]?.id).toBe(targetId);
  });

  it("closes only the requested window id", () => {
    openShellModal("c-1");
    openShellModal("c-1");
    const state = get(shellModalState);
    const keepId = state[0]?.id;
    const closeId = state[1]?.id;
    expect(keepId).toBeTruthy();
    expect(closeId).toBeTruthy();

    closeShellModal(closeId!);
    const next = get(shellModalState);

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe(keepId);
  });
});
