import { describe, expect, it } from "vitest";
import { clearPodsRequestDedupeForTests, dedupePodsRequest } from "./pods-request-dedupe";

describe("pods request dedupe", () => {
  it("reuses in-flight request for identical scope", async () => {
    clearPodsRequestDedupeForTests();
    let runs = 0;
    const request = () =>
      dedupePodsRequest("pods.logs", "dev:default/demo", async () => {
        runs += 1;
        await Promise.resolve();
        return "ok";
      });
    const [a, b] = await Promise.all([request(), request()]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(runs).toBe(1);
  });
});
