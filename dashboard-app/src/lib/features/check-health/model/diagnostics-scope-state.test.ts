import { describe, expect, it } from "vitest";
import {
  getDiagnosticsScopeLoadedAt,
  hasFreshDiagnosticsScope,
  hasLoadedDiagnosticsScope,
} from "./diagnostics-scope-state";

describe("diagnostics scope state", () => {
  it("treats explicit scope markers as the source of truth for freshness", () => {
    const check = {
      timestamp: 2_000,
      diagnosticsSnapshots: {
        configLoadedAt: 1_000,
        healthLoadedAt: 4_000,
      },
    } as any;

    expect(getDiagnosticsScopeLoadedAt(check, "config")).toBe(1_000);
    expect(hasFreshDiagnosticsScope(check, "config", 500, 2_000)).toBe(false);
    expect(hasFreshDiagnosticsScope(check, "health", 500, 4_250)).toBe(true);
  });

  it("falls back to legacy diagnostics data when markers are absent", () => {
    const check = {
      timestamp: 5_000,
      resourcesHygiene: { status: "warning" },
      apiServerHealth: { status: "ok" },
    } as any;

    expect(hasLoadedDiagnosticsScope(check, "config")).toBe(true);
    expect(hasLoadedDiagnosticsScope(check, "health")).toBe(true);
    expect(getDiagnosticsScopeLoadedAt(check, "config")).toBe(5_000);
  });

  it("does not report a scope as loaded when no diagnostics results exist", () => {
    const check = { timestamp: 9_000 } as any;

    expect(hasLoadedDiagnosticsScope(check, "config")).toBe(false);
    expect(hasLoadedDiagnosticsScope(check, "health")).toBe(false);
  });
});
