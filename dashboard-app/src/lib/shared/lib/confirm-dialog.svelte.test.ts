import { afterEach, describe, expect, it } from "vitest";
import {
  confirmDialog,
  hasConfirmHost,
  registerConfirmHost,
  requestConfirm,
  settleConfirm,
} from "./confirm-dialog.svelte";

function settled(promise: Promise<boolean>): Promise<boolean | "pending"> {
  return Promise.race([promise, new Promise<"pending">((r) => setTimeout(() => r("pending"), 0))]);
}

describe("confirm dialog queue", () => {
  afterEach(() => {
    while (confirmDialog.current) settleConfirm(false);
  });

  it("answers requests one at a time, in the order they were asked", async () => {
    const first = requestConfirm({ title: "Stop port-forward", message: "Stop it?" });
    const second = requestConfirm({ title: "Close tab", message: "Close it?" });
    expect(confirmDialog.current?.title).toBe("Stop port-forward");
    expect(confirmDialog.queued).toBe(1);
    await expect(settled(second)).resolves.toBe("pending");

    settleConfirm(true);
    await expect(first).resolves.toBe(true);
    expect(confirmDialog.current?.title).toBe("Close tab");
    expect(confirmDialog.queued).toBe(0);

    settleConfirm(false);
    await expect(second).resolves.toBe(false);
    expect(confirmDialog.current).toBeNull();
  });

  it("settling with nothing on screen is a no-op", () => {
    expect(confirmDialog.current).toBeNull();
    expect(() => settleConfirm(true)).not.toThrow();
  });

  it("the last host leaving answers No to everything still waiting", async () => {
    const unregister = registerConfirmHost();
    expect(hasConfirmHost()).toBe(true);
    const first = requestConfirm({ title: "Cordon node", message: "Cordon?" });
    const second = requestConfirm({ title: "Discard edits?", message: "Discard?" });

    unregister();
    expect(hasConfirmHost()).toBe(false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(confirmDialog.current).toBeNull();
  });

  it("a host that unregisters twice counts once", () => {
    const first = registerConfirmHost();
    const second = registerConfirmHost();
    first();
    first();
    expect(hasConfirmHost()).toBe(true);
    second();
    expect(hasConfirmHost()).toBe(false);
  });
});
