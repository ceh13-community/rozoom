import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import DetailsEventsList from "./details-events-list.svelte";
import { groupDetailsEvents } from "./details-events-model";

const pulled = {
  type: "Normal",
  reason: "Pulled",
  message: "Container image already present",
  lastTimestamp: "2026-11-22T00:00:10Z",
};
const backOff = {
  type: "Warning",
  reason: "BackOff",
  message: "Back-off restarting failed container web",
  lastTimestamp: "2026-11-22T00:00:05Z",
  count: 4,
};

describe("groupDetailsEvents", () => {
  it("folds repeats into one row and adds up Kubernetes' counts", () => {
    const rows = groupDetailsEvents([
      backOff,
      { ...backOff, lastTimestamp: "2026-11-22T00:01:00Z", count: 3, source: "kubelet" },
      pulled,
      pulled,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reason: "BackOff",
      count: 7,
      lastTimestamp: "2026-11-22T00:01:00Z",
      source: "kubelet",
    });
    expect(rows[1]).toMatchObject({ reason: "Pulled", count: 2 });
  });

  it("puts Warning events first, newest first within each type", () => {
    const rows = groupDetailsEvents([
      pulled,
      { ...pulled, reason: "Started", lastTimestamp: "2026-11-22T00:02:00Z" },
      backOff,
      { ...backOff, reason: "Unhealthy", lastTimestamp: "2026-11-22T00:00:01Z", count: 1 },
    ]);
    expect(rows.map((row) => row.reason)).toEqual(["BackOff", "Unhealthy", "Started", "Pulled"]);
  });

  it("keeps the same event of different objects apart", () => {
    const rows = groupDetailsEvents([
      { ...backOff, object: "pod/web-1" },
      { ...backOff, object: "pod/web-2" },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("DetailsEventsList", () => {
  it("shows one row per event, xN for repeats, Warning on top", () => {
    const { getAllByTestId } = render(DetailsEventsList, {
      props: { events: [pulled, backOff, { ...backOff, count: 1 }] },
    });
    const rows = getAllByTestId("details-event");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("BackOff");
    expect(rows[0].textContent).toContain("x5");
    expect(rows[1].textContent).toContain("Pulled");
    expect(rows[1].textContent).not.toMatch(/x\d/);
  });
});
