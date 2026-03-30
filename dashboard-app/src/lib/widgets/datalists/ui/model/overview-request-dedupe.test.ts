import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearOverviewRequestDedupeForTests,
  dedupeOverviewRequest,
} from "./overview-request-dedupe";

describe("overview-request-dedupe", () => {
  beforeEach(() => {
    clearOverviewRequestDedupeForTests();
  });

  it("reuses in-flight request for same kind+scope", async () => {
    let calls = 0;
    let resolve: ((value: string) => void) | null = null;
    const request = vi.fn(
      () =>
        new Promise<string>((done) => {
          calls += 1;
          resolve = done;
        }),
    );

    const a = dedupeOverviewRequest("events", "cluster-a", request);
    const b = dedupeOverviewRequest("events", "cluster-a", request);

    expect(a).toBe(b);
    expect(calls).toBe(1);

    if (!resolve) throw new Error("Expected in-flight resolver");
    (resolve as (value: string) => void)("ok");
    await expect(a).resolves.toBe("ok");
    await expect(b).resolves.toBe("ok");
  });

  it("does not reuse across different scope and allows re-run after settle", async () => {
    const request = vi.fn().mockResolvedValue("ok");

    await dedupeOverviewRequest("events", "cluster-a", request);
    await dedupeOverviewRequest("events", "cluster-b", request);
    await dedupeOverviewRequest("events", "cluster-a", request);

    expect(request).toHaveBeenCalledTimes(3);
  });
});
