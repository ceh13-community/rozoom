import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeDebugLog = vi.fn().mockResolvedValue(undefined);

vi.mock("./tauri-runtime", () => ({
  safeDebugLog,
}));

describe("runtime-debug", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isRuntimeDebugEnabled", () => {
    it("returns false when VITE_ENABLE_RUNTIME_FILE_LOGS is not 'true'", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "false");
      const { isRuntimeDebugEnabled } = await import("./runtime-debug");
      expect(isRuntimeDebugEnabled()).toBe(false);
      expect(isRuntimeDebugEnabled("kubectl")).toBe(false);
    });

    it("returns true for all scopes when VITE_ENABLE_VERBOSE_RUNTIME_LOGS is 'true'", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "true");
      vi.stubEnv("VITE_ENABLE_VERBOSE_RUNTIME_LOGS", "true");
      const { isRuntimeDebugEnabled } = await import("./runtime-debug");
      expect(isRuntimeDebugEnabled()).toBe(true);
      expect(isRuntimeDebugEnabled("runtime")).toBe(true);
      expect(isRuntimeDebugEnabled("kubectl")).toBe(true);
      expect(isRuntimeDebugEnabled("overview")).toBe(true);
      expect(isRuntimeDebugEnabled("watchers")).toBe(true);
      expect(isRuntimeDebugEnabled("background-pollers")).toBe(true);
    });

    it("returns true for kubectl scope when VITE_ENABLE_KUBECTL_TRACE is 'true'", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "true");
      vi.stubEnv("VITE_ENABLE_VERBOSE_RUNTIME_LOGS", "false");
      vi.stubEnv("VITE_ENABLE_KUBECTL_TRACE", "true");
      const { isRuntimeDebugEnabled } = await import("./runtime-debug");
      expect(isRuntimeDebugEnabled("kubectl")).toBe(true);
    });

    it("returns false for runtime scope even when file logs enabled but not verbose", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "true");
      vi.stubEnv("VITE_ENABLE_VERBOSE_RUNTIME_LOGS", "false");
      const { isRuntimeDebugEnabled } = await import("./runtime-debug");
      expect(isRuntimeDebugEnabled("runtime")).toBe(false);
    });
  });

  describe("writeRuntimeDebugLog", () => {
    it("calls safeDebugLog with formatted JSON when enabled", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "true");
      vi.stubEnv("VITE_ENABLE_VERBOSE_RUNTIME_LOGS", "true");
      const { writeRuntimeDebugLog } = await import("./runtime-debug");

      await writeRuntimeDebugLog("kubectl", "test-event", { key: "value" });

      expect(safeDebugLog).toHaveBeenCalledTimes(1);
      const logArg = safeDebugLog.mock.calls[0][0] as string;
      expect(logArg).toMatch(/^\[runtime:kubectl\] /);
      const jsonPart = logArg.replace("[runtime:kubectl] ", "");
      const parsed = JSON.parse(jsonPart);
      expect(parsed.event).toBe("test-event");
      expect(parsed.key).toBe("value");
      expect(parsed.ts).toBeDefined();
    });

    it("skips call when disabled", async () => {
      vi.stubEnv("VITE_ENABLE_RUNTIME_FILE_LOGS", "false");
      const { writeRuntimeDebugLog } = await import("./runtime-debug");

      await writeRuntimeDebugLog("kubectl", "test-event");

      expect(safeDebugLog).not.toHaveBeenCalled();
    });
  });
});
