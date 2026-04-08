import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleGlobalKeydown,
  pushOverlay,
  registerShortcut,
  resetKeyboardManager,
} from "./keyboard-manager";

function key(keyName: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: keyName,
    bubbles: true,
    ...opts,
  });
}

afterEach(() => {
  resetKeyboardManager();
});

describe("keyboard-manager", () => {
  describe("simple shortcuts", () => {
    it("fires handler for single-key shortcut", () => {
      const handler = vi.fn();
      registerShortcut("/", handler);
      handleGlobalKeydown(key("/"));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("fires handler for mod+k shortcut with Ctrl on non-Mac", () => {
      const handler = vi.fn();
      // Mock non-Mac platform
      vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "Linux" });
      registerShortcut("mod+k", handler);
      handleGlobalKeydown(key("k", { ctrlKey: true }));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("does not fire single-key when input is focused", () => {
      const handler = vi.fn();
      registerShortcut("/", handler);

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      try {
        handleGlobalKeydown(key("/"));
        expect(handler).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(input);
      }
    });

    it("fires mod+key even when input is focused", () => {
      const handler = vi.fn();
      vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "Linux" });
      registerShortcut("mod+k", handler);

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      try {
        handleGlobalKeydown(key("k", { ctrlKey: true }));
        expect(handler).toHaveBeenCalledOnce();
      } finally {
        document.body.removeChild(input);
      }
    });

    it("respects when guard", () => {
      const handler = vi.fn();
      registerShortcut("/", handler, () => false);
      handleGlobalKeydown(key("/"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("unregisters shortcut when dispose is called", () => {
      const handler = vi.fn();
      const dispose = registerShortcut("/", handler);
      dispose();
      handleGlobalKeydown(key("/"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not fire single-key when Ctrl is held (e.g. Ctrl+J)", () => {
      const handler = vi.fn();
      registerShortcut("j", handler);
      handleGlobalKeydown(key("j", { ctrlKey: true }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("chord sequences", () => {
    it("fires handler for g d chord", () => {
      const handler = vi.fn();
      registerShortcut("g d", handler);
      handleGlobalKeydown(key("g"));
      handleGlobalKeydown(key("d"));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("does not fire chord if second key is wrong", () => {
      const handler = vi.fn();
      registerShortcut("g d", handler);
      handleGlobalKeydown(key("g"));
      handleGlobalKeydown(key("x"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not fire chord after timeout", () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      registerShortcut("g d", handler);
      handleGlobalKeydown(key("g"));
      vi.advanceTimersByTime(1000);
      handleGlobalKeydown(key("d"));
      expect(handler).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("overlay escape stack", () => {
    it("closes topmost overlay on Escape", () => {
      const close1 = vi.fn();
      const close2 = vi.fn();
      pushOverlay("dialog-1", close1);
      pushOverlay("dialog-2", close2);
      handleGlobalKeydown(key("Escape"));
      expect(close2).toHaveBeenCalledOnce();
      expect(close1).not.toHaveBeenCalled();
    });

    it("closes overlays in LIFO order", () => {
      const close1 = vi.fn();
      const close2 = vi.fn();
      pushOverlay("dialog-1", close1);
      pushOverlay("dialog-2", close2);
      handleGlobalKeydown(key("Escape"));
      handleGlobalKeydown(key("Escape"));
      expect(close2).toHaveBeenCalledOnce();
      expect(close1).toHaveBeenCalledOnce();
    });

    it("removes overlay when dispose is called", () => {
      const close1 = vi.fn();
      const dispose = pushOverlay("dialog-1", close1);
      dispose();
      handleGlobalKeydown(key("Escape"));
      expect(close1).not.toHaveBeenCalled();
    });
  });
});
