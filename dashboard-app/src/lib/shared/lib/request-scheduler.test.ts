import { describe, expect, it } from "vitest";
import { createRequestScheduler } from "./request-scheduler";

describe("request-scheduler", () => {
  it("respects max concurrency", async () => {
    const scheduler = createRequestScheduler(2);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }).map(() =>
      scheduler.schedule(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return active;
      }),
    );
    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("runs higher-priority tasks first within queue", async () => {
    const scheduler = createRequestScheduler(1);
    const order: string[] = [];
    const makeTask =
      (id: string, wait = 1) =>
      async () => {
        order.push(`start:${id}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        order.push(`end:${id}`);
        return id;
      };

    const a = scheduler.schedule(makeTask("a", 10), { priority: 0 });
    const b = scheduler.schedule(makeTask("b"), { priority: 0 });
    const c = scheduler.schedule(makeTask("c"), { priority: 10 });
    await Promise.all([a, b, c]);

    expect(order).toEqual(["start:a", "end:a", "start:c", "end:c", "start:b", "end:b"]);
  });

  it("drains a long queue without exceeding bounded concurrency", async () => {
    const scheduler = createRequestScheduler(4);
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];

    const tasks = Array.from({ length: 100 }, (_, index) =>
      scheduler.schedule(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        completed.push(index);
        active -= 1;
        return index;
      }),
    );

    await Promise.all(tasks);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(completed).toHaveLength(100);
    expect(scheduler.getActiveCount()).toBe(0);
    expect(scheduler.getQueuedCount()).toBe(0);
  });
});
