import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast }));

import {
  cliNotificationTitle,
  emitCliNotification,
  initCliNotifications,
  isUserFacingCommand,
  suppressCliNotifications,
} from "./cli-notification";

describe("CLI notifications", () => {
  it("a write is user-facing, a read is not; helm rollback counts as a write", () => {
    expect(isUserFacingCommand(["delete", "pod", "web-a", "-n", "shop"])).toBe(true);
    expect(isUserFacingCommand(["rollout", "restart", "deployment/web"])).toBe(true);
    expect(isUserFacingCommand(["rollback", "web", "3", "--kubeconfig", "/k"])).toBe(true);
    expect(isUserFacingCommand(["uninstall", "web"])).toBe(true);
    expect(isUserFacingCommand(["list", "-A", "-o", "json"])).toBe(false);
    expect(isUserFacingCommand(["get", "pods", "-o", "json"])).toBe(false);
    expect(isUserFacingCommand(["--kubeconfig", "/k", "get", "pods"])).toBe(false);
  });

  it("the toast title carries the completion time when it is known", () => {
    expect(cliNotificationTitle({ success: true, durationMs: 1234 })).toBe(
      "Command executed in 1.2 s",
    );
    expect(cliNotificationTitle({ success: false, durationMs: 80 })).toBe(
      "Command failed in 0.1 s",
    );
    expect(cliNotificationTitle({ success: true })).toBe("Command executed");
  });

  it("shows the command, the time and a Copy action, and nothing while suppressed", () => {
    const stop = initCliNotifications();
    try {
      suppressCliNotifications(true);
      emitCliNotification({ tool: "kubectl", args: ["delete", "pod", "web-a"], success: true });
      expect(toast.success).not.toHaveBeenCalled();

      suppressCliNotifications(false);
      emitCliNotification({
        tool: "kubectl",
        args: ["delete", "pod", "web-a", "--kubeconfig=/k/c.yaml"],
        success: true,
        durationMs: 2500,
      });
      expect(toast.success).toHaveBeenCalledWith(
        "Command executed in 2.5 s",
        expect.objectContaining({
          description: "kubectl delete pod web-a",
          action: expect.objectContaining({ label: "Copy" }),
        }),
      );
    } finally {
      suppressCliNotifications(true);
      stop();
    }
  });
});
