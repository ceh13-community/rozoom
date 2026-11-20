import { afterEach, describe, expect, it, vi } from "vitest";

const { confirmAction, toast } = vi.hoisted(() => ({
  confirmAction: vi.fn(async () => true),
  toast: vi.fn(),
}));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction }));
vi.mock("svelte-sonner", () => ({ toast }));

import {
  WORKBENCH_UNDO_TOAST_MS,
  announceWorkbenchTabClosed,
  confirmWorkbenchTabClose,
  hasUnsavedYaml,
  isSameClosedTab,
  undoForClosedTab,
} from "./workbench-confirm";

afterEach(() => {
  confirmAction.mockClear();
  toast.mockClear();
});

describe("workbench close rule", () => {
  it.each(["logs", "events", "rollout-status", "rollout-history", "investigate", "port-forward"])(
    "closes a %s tab without asking",
    async (kind) => {
      await expect(confirmWorkbenchTabClose({ kind, title: "web" })).resolves.toBe(true);
      expect(confirmAction).not.toHaveBeenCalled();
    },
  );

  it("closes a YAML tab without edits without asking", async () => {
    const yaml = { yamlText: "kind: Pod\n", yamlOriginalText: "kind: Pod\n" };
    await expect(
      confirmWorkbenchTabClose({
        kind: "yaml",
        title: "web",
        hasUnsavedChanges: hasUnsavedYaml(yaml),
      }),
    ).resolves.toBe(true);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("asks before dropping unsaved YAML edits and honours cancel", async () => {
    confirmAction.mockResolvedValueOnce(false);
    const yaml = { yamlText: "kind: Pod\nx: 1\n", yamlOriginalText: "kind: Pod\n" };
    await expect(
      confirmWorkbenchTabClose({
        kind: "yaml",
        title: "web",
        subtitle: "default",
        hasUnsavedChanges: hasUnsavedYaml(yaml),
      }),
    ).resolves.toBe(false);
    expect(confirmAction).toHaveBeenCalledWith(
      "Close this YAML tab?\nweb - default\nUnsaved changes will be lost.",
      "Close tab",
    );
  });

  it("asks before stopping a running port-forward", async () => {
    await confirmWorkbenchTabClose({ kind: "port-forward", title: "web", stopsPortForward: true });
    expect(confirmAction).toHaveBeenCalledWith(
      "Close this port forward tab?\nweb\nThe port-forward will stop.",
      "Close tab",
    );
  });

  it("treats a missing YAML tab as clean", () => {
    expect(hasUnsavedYaml(null)).toBe(false);
    expect(hasUnsavedYaml({ yamlText: "a", yamlOriginalText: "a" })).toBe(false);
    expect(hasUnsavedYaml({ yamlText: "b", yamlOriginalText: "a" })).toBe(true);
  });

  it("announces a closed tab with an 8 second Undo", () => {
    const onUndo = vi.fn();
    announceWorkbenchTabClosed({ title: "Logs", subtitle: "default/web" }, onUndo);
    expect(toast).toHaveBeenCalledWith("Tab closed: Logs - default/web", {
      duration: WORKBENCH_UNDO_TOAST_MS,
      action: { label: "Undo", onClick: onUndo },
    });
    expect(WORKBENCH_UNDO_TOAST_MS).toBe(8000);
  });
});

describe("Undo of a closed tab", () => {
  const logs = { kind: "logs", target: { name: "web", namespace: "shop" } };

  it("reopens exactly the entry it was made for", () => {
    const reopen = vi.fn();
    undoForClosedTab({ kind: "logs" }, logs, reopen)?.();
    expect(reopen).toHaveBeenCalledWith(logs);
  });

  it("offers no Undo for unsaved YAML edits, a port-forward, or nothing remembered", () => {
    const reopen = vi.fn();
    expect(
      undoForClosedTab({ kind: "yaml", hasUnsavedChanges: true }, logs, reopen),
    ).toBeUndefined();
    expect(undoForClosedTab({ kind: "port-forward" }, logs, reopen)).toBeUndefined();
    expect(undoForClosedTab({ kind: "logs" }, undefined, reopen)).toBeUndefined();
  });

  it("tells closed tabs apart by kind and object", () => {
    expect(
      isSameClosedTab(logs, { kind: "logs", target: { name: "web", namespace: "shop" } }),
    ).toBe(true);
    expect(
      isSameClosedTab(logs, { kind: "yaml", target: { name: "web", namespace: "shop" } }),
    ).toBe(false);
    expect(
      isSameClosedTab(logs, { kind: "logs", target: { name: "api", namespace: "shop" } }),
    ).toBe(false);
  });
});
