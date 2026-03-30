import { describe, expect, it } from "vitest";
import {
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
  fromLegacyAction,
  fromActionNotice,
} from "./action-notification";

describe("action-notification", () => {
  it("creates success notification with auto-dismiss", () => {
    const n = notifySuccess("Deleted 3 pods.");
    expect(n?.type).toBe("success");
    expect(n?.message).toBe("Deleted 3 pods.");
    expect(n?.autoDismissMs).toBeGreaterThan(0);
  });

  it("creates error notification without auto-dismiss", () => {
    const n = notifyError("Failed to scale.", "timeout after 10s");
    expect(n?.type).toBe("error");
    expect(n?.detail).toBe("timeout after 10s");
    expect(n?.autoDismissMs).toBeUndefined();
  });

  it("creates warning notification", () => {
    const n = notifyWarning("Pod is restarting frequently.");
    expect(n?.type).toBe("warning");
  });

  it("creates info notification with auto-dismiss", () => {
    const n = notifyInfo("Copied to clipboard.");
    expect(n?.type).toBe("info");
    expect(n?.autoDismissMs).toBeGreaterThan(0);
  });

  it("converts legacy actionMessage", () => {
    expect(fromLegacyAction("Scaled to 3.", null)?.type).toBe("success");
    expect(fromLegacyAction(null, "Failed")?.type).toBe("error");
    expect(fromLegacyAction(null, null)).toBeNull();
  });

  it("error takes precedence over message in legacy", () => {
    const n = fromLegacyAction("OK", "Fail");
    expect(n?.type).toBe("error");
    expect(n?.message).toBe("Fail");
  });

  it("converts Helm actionNotice", () => {
    expect(fromActionNotice({ type: "success", text: "Repo added." })?.type).toBe("success");
    expect(fromActionNotice({ type: "error", text: "Failed." })?.type).toBe("error");
    expect(fromActionNotice(null)).toBeNull();
  });
});
