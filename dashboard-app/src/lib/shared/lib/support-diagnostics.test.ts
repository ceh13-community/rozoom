import { describe, expect, it, vi } from "vitest";
import { buildSupportReport, readRecentLogTail } from "./support-diagnostics";

vi.mock("./tauri-runtime", () => ({ isTauriAvailable: () => false }));

describe("buildSupportReport", () => {
  it("assembles message, version, timestamp and redacted log tail", () => {
    const report = buildSupportReport({
      message: "Failed to load pods: Authorization: Bearer abcdefghijklmnop",
      status: 500,
      route: "/dashboard/pods",
      appVersion: "0.22.6",
      now: new Date("2026-09-01T07:00:00Z"),
      logTail:
        "[2026-09-01][08:59:59][ERROR][webview:kubectl] token: eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz\n[2026-09-01][09:00:00][INFO][webview] boom",
    });

    expect(report).toContain("Version: 0.22.6");
    expect(report).toContain("Time: 2026-09-01T07:00:00.000Z");
    expect(report).toContain("Route: /dashboard/pods");
    expect(report).toContain("Status: 500");
    expect(report).toContain("Error: Failed to load pods: Authorization: [REDACTED]");
    expect(report).toContain("token: [REDACTED]");
    expect(report).toContain("[webview] boom");
    expect(report).not.toContain("abcdefghijklmnop");
    expect(report).not.toContain("eyJhbGci");
  });

  it("still produces a report when there is no log file", () => {
    const report = buildSupportReport({ message: "", appVersion: "0.22.6", logTail: "" });
    expect(report).toContain("Error: unknown error");
    expect(report).toContain("--- no log file yet ---");
  });
});

describe("readRecentLogTail", () => {
  it("returns empty outside the desktop runtime", async () => {
    await expect(readRecentLogTail()).resolves.toBe("");
  });
});
