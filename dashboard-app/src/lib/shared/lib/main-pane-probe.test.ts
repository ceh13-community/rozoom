import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import {
  createMainPaneProbe,
  MIN_AWAY_MS,
  NAVIGATE_DELAY_MS,
  RESTORE_DELAY_MS,
} from "./main-pane-probe";
import {
  formatMainPaneLine,
  looksBlank,
  probeRoute,
  TEXT_CAP,
  type MainPaneState,
} from "./main-pane-state";

// What the pane measures needs layout, which jsdom does not have: those cases run in a
// real browser in e2e/main-pane-state.spec.ts. This file covers the rest.

const healthy: MainPaneState = {
  visibility: "visible",
  focused: true,
  width: 1180,
  height: 820,
  scrollHeight: 2400,
  scrollTop: 0,
  elements: 900,
  text: 4200,
  invisible: 0,
  hits: 9,
  animations: 0,
  center: "content",
};

describe("looksBlank", () => {
  it("is false for a pane that shows content", () => {
    expect(looksBlank(healthy)).toBe(false);
  });

  it.each([
    ["no elements", { elements: 0 }],
    ["no visible text", { text: 0 }],
    ["an invisible block", { invisible: 1 }],
    ["no grid point on content", { hits: 0 }],
  ])("is true with %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(true);
  });

  it.each([
    ["a short page with nothing at the centre", { center: "main", hits: 3 }],
    ["a sheet open over the pane", { center: "outside:div[dialog-overlay]", hits: 6 }],
  ])("is false for %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(false);
  });

  it("is false while the window is hidden", () => {
    expect(looksBlank({ ...healthy, visibility: "hidden", elements: 0 })).toBe(false);
  });
});

describe("probeRoute", () => {
  it("keeps a plain workload slug", () => {
    expect(probeRoute("/dashboard/clusters/[slug]", "daemonsets")).toBe(
      "/dashboard/clusters/[slug]?workload=daemonsets",
    );
  });

  it.each([
    ["an uppercase value", "Pods"],
    ["a path", "../secrets"],
    ["a token-like value", "eyJhbGciOiJSUzI1NiJ9.payload"],
    ["an overlong slug", "a".repeat(41)],
  ])("replaces %s with other", (_, workload) => {
    expect(probeRoute("/dashboard/clusters/[slug]", workload)).toBe(
      "/dashboard/clusters/[slug]?workload=other",
    );
  });

  it("leaves the workload out when there is none", () => {
    expect(probeRoute("/dashboard", null)).toBe("/dashboard");
    expect(probeRoute(null, null)).toBe("unknown");
  });
});

describe("formatMainPaneLine", () => {
  it("writes every field as a number or a fixed word", () => {
    expect(formatMainPaneLine(healthy, "/dashboard", "navigate")).toBe(
      "[main-pane] trigger=navigate route=/dashboard visibility=visible focus=1 size=1180x820 " +
        "scroll=0/2400 elements=900 text=4200 invisible=0 hits=9/9 animations=0 center=content",
    );
  });

  it("marks capped text", () => {
    expect(formatMainPaneLine({ ...healthy, text: TEXT_CAP }, "/dashboard", "focus")).toContain(
      `text=${TEXT_CAP}+`,
    );
  });
});

describe("createMainPaneProbe", () => {
  function setup(main: HTMLElement | null = document.createElement("main")) {
    let clock = 0;
    const pending: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
    const write = vi.fn();
    const probe = createMainPaneProbe({
      getMain: () => main,
      getRoute: () => "/dashboard",
      write,
      now: () => clock,
      schedule: (callback, delayMs) => {
        const entry = { callback, delayMs, cancelled: false };
        pending.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
      describe: () => healthy,
    });
    const flush = () => {
      for (const entry of pending.splice(0)) if (!entry.cancelled) entry.callback();
    };
    return {
      probe,
      write,
      pending,
      flush,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("writes one line a few seconds after a navigation", () => {
    const { probe, write, pending, flush } = setup();
    probe.navigated();
    expect(pending[0].delayMs).toBe(NAVIGATE_DELAY_MS);
    flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("trigger=navigate");
    expect(write.mock.calls[0][1]).toBe(false);
  });

  it("writes only for the last of quick navigations", () => {
    const { probe, write, flush } = setup();
    probe.navigated();
    probe.navigated();
    probe.navigated();
    flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("skips ordinary window switching", () => {
    const { probe, write, pending, advance } = setup();
    probe.hidden();
    advance(MIN_AWAY_MS - 1);
    probe.shown("focus");
    expect(pending).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes after the window was away for a while, once per return", () => {
    const { probe, write, pending, flush, advance } = setup();
    probe.hidden();
    probe.hidden();
    advance(MIN_AWAY_MS);
    probe.shown("focus");
    probe.shown("visible");
    expect(pending.map((entry) => entry.delayMs)).toEqual([RESTORE_DELAY_MS]);
    flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("trigger=focus");
  });

  it("does nothing without a main pane", () => {
    const { probe, write, flush } = setup(null);
    probe.navigated();
    flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("never throws into the page", () => {
    const failing = createMainPaneProbe({
      getMain: () => document.createElement("main"),
      getRoute: () => "/dashboard",
      write: () => Promise.reject(new Error("log plugin gone")),
      schedule: (callback) => {
        callback();
        return () => undefined;
      },
      describe: () => {
        throw new Error("layout read failed");
      },
    });
    expect(() => {
      failing.navigated();
    }).not.toThrow();
  });

  it("cancels a pending probe on dispose", () => {
    const { probe, write, flush } = setup();
    probe.navigated();
    probe.dispose();
    flush();
    expect(write).not.toHaveBeenCalled();
  });
});
