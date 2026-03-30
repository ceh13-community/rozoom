import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/features/backup-audit/model/store.ts"), "utf8");

describe("backup audit route gating contract", () => {
  it("allows backup audit polling on dashboard cards and the dedicated workload page", () => {
    expect(source).toContain("dashboardRoot: true");
    expect(source).toContain('workloads: ["backupaudit"]');
  });
});
