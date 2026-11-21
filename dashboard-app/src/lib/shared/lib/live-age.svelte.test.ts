import { flushSync, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveAge } from "./live-age.svelte";

const START = new Date("2026-11-21T12:00:00Z").getTime();

// An Age cell: an effect that reads liveAge() for one timestamp and records every label
// it renders. `rows` counts how often the row data itself is rebuilt: never, here.
const mounted: Array<() => void> = [];

function mountAgeCell(since: string | undefined) {
  const labels: string[] = [];
  let rows = 0;
  const stop = $effect.root(() => {
    const row = { since };
    rows += 1;
    $effect(() => {
      labels.push(liveAge(row.since));
    });
  });
  flushSync();
  mounted.push(stop);
  return {
    labels,
    get rows() {
      return rows;
    },
    stop,
  };
}

// One flush per tick, the way the browser paints between interval callbacks.
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
    vi.advanceTimersByTime(Math.min(1_000, ms - elapsed));
    flushSync();
  }
}

// The clock stops its timer in a microtask after the last reader goes away.
async function unmountAll() {
  while (mounted.length) mounted.pop()?.();
  await tick();
  await Promise.resolve();
}

describe("liveAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(async () => {
    await unmountAll();
    vi.useRealTimers();
  });

  it("counts up every second without a new row", () => {
    const cell = mountAgeCell(new Date(START - 3_000).toISOString());
    expect(cell.labels).toEqual(["3s"]);

    advance(1_000);
    advance(1_000);
    advance(1_000);

    expect(cell.labels).toEqual(["3s", "4s", "5s", "6s"]);
    expect(cell.rows).toBe(1);
  });

  it("moves from seconds to minutes and then changes once a minute", () => {
    const cell = mountAgeCell(new Date(START - 58_000).toISOString());

    advance(3_000); // 1m01s
    expect(cell.labels).toEqual(["58s", "59s", "1m", "1m"]);

    const distinct = () => [...new Set(cell.labels)];
    advance(58_000); // 1m59s
    expect(distinct()).toEqual(["58s", "59s", "1m"]);

    advance(1_000); // 2m00s
    expect(distinct()).toEqual(["58s", "59s", "1m", "2m"]);
  });

  it("stops its timer when no cell reads it", async () => {
    const cell = mountAgeCell(new Date(START).toISOString());
    expect(vi.getTimerCount()).toBe(1);
    await unmountAll();
    expect(vi.getTimerCount()).toBe(0);
    advance(5_000);
    expect(cell.labels).toEqual(["0s"]);
  });

  it("shares one timer between cells", () => {
    const a = mountAgeCell(new Date(START - 10_000).toISOString());
    const b = mountAgeCell(new Date(START - 3_600_000).toISOString());
    expect(vi.getTimerCount()).toBe(1);
    advance(1_000);
    expect(a.labels).toEqual(["10s", "11s"]);
    expect(b.labels.at(-1)).toBe("1h");
  });

  it("shows the fallback for a missing or invalid timestamp", () => {
    expect(liveAge(undefined)).toBe("-");
    expect(liveAge("not a date", "n/a")).toBe("n/a");
  });

  it("reads the wall clock outside an effect", () => {
    expect(liveAge(new Date(START - 90_000))).toBe("1m");
    vi.setSystemTime(START + 60_000);
    expect(liveAge(new Date(START - 90_000))).toBe("2m");
  });
});
