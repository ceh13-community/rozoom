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
  SETTLE_RETRY_MS,
} from "./main-pane-probe";
import {
  describeLayer,
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
  hits: 25,
  covered: 0,
  animations: 0,
  center: "content",
  layer: "none",
  bodyPointer: "auto",
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
    ["no grid point on content and a toast in one corner", { hits: 0, covered: 1 }],
  ])("is true with %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(true);
  });

  it.each([
    ["a short page with nothing at the centre", { center: "main", hits: 3 }],
    ["a sheet open over the pane", { center: "outside:div[dialog-overlay]", hits: 6 }],
    [
      "a modal sheet covering every point",
      { center: "outside:div[sheet-overlay]", hits: 0, covered: 25 },
    ],
  ])("is false for %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(false);
  });

  it("is false while the window is hidden", () => {
    expect(looksBlank({ ...healthy, visibility: "hidden", elements: 0 })).toBe(false);
  });
});

// The field line said only "outside:div" or "outside:html" for a covered pane, which did
// not tell which layer it was.
describe("describeLayer", () => {
  function setupLayer(html: string) {
    document.body.innerHTML = `<main id="pane"><p id="row">row</p></main>${html}`;
    const main = document.getElementById("pane") as HTMLElement;
    return { main, find: (id: string) => document.getElementById(id) };
  }

  it("names the positioned layer by tag, role, data-attribute names and z-index", () => {
    const { main, find } = setupLayer(
      '<div role="dialog" data-details-panel data-state="open" data-name="payments-api" style="position:fixed;z-index:180"><pre id="out">secret-output</pre></div>',
    );
    const layer = describeLayer(main, find("out"), window);
    expect(layer).toBe("div:role-dialog:data-details-panel:data-state:data-name:z180");
    expect(layer).not.toContain("payments-api");
    expect(layer).not.toContain("secret-output");
  });

  it("says root when the hit is the document element, none when the pane is on top", () => {
    const { main, find } = setupLayer("");
    expect(describeLayer(main, document.documentElement, window)).toBe("root");
    expect(describeLayer(main, find("row"), window)).toBe("none");
    expect(describeLayer(main, null, window)).toBe("none");
  });

  it("says in-flow when no positioned ancestor with a z-index holds the hit", () => {
    const { main, find } = setupLayer('<aside><span id="label">Pods</span></aside>');
    expect(describeLayer(main, find("label"), window)).toBe("span:in-flow");
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
        "scroll=0/2400 elements=900 text=4200 invisible=0 hits=25/25 covered=0/25 animations=0 " +
        "center=content layer=none body-pointer=auto",
    );
  });

  it("marks capped text", () => {
    expect(formatMainPaneLine({ ...healthy, text: TEXT_CAP }, "/dashboard", "focus")).toContain(
      `text=${TEXT_CAP}+`,
    );
  });
});

describe("createMainPaneProbe", () => {
  function setup(
    main: HTMLElement | null = document.createElement("main"),
    readings: MainPaneState[] = [],
  ) {
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
      describe: () => readings.shift() ?? healthy,
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

  // Global Triage three seconds after navigation: skeletons only, hits=0 animations=7.
  const loading: MainPaneState = { ...healthy, text: 0, hits: 0, animations: 7 };

  it("measures a blank pane that is still animating once more before writing", () => {
    const { probe, write, pending, flush } = setup(undefined, [loading]);
    probe.navigated();
    flush();
    expect(write).not.toHaveBeenCalled();
    expect(pending.at(-1)?.delayMs).toBe(SETTLE_RETRY_MS);
    flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("trigger=navigate settle=retry ");
    expect(write.mock.calls[0][1]).toBe(false);
  });

  it("writes the warn line when the pane is still blank on the second look", () => {
    const { probe, write, flush } = setup(undefined, [loading, loading]);
    probe.navigated();
    flush();
    flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("settle=retry");
    expect(write.mock.calls[0][0]).toContain("animations=7");
    expect(write.mock.calls[0][1]).toBe(true);
  });

  it("writes a blank pane without animations at once", () => {
    const { probe, write, flush } = setup(undefined, [{ ...loading, animations: 0 }]);
    probe.navigated();
    flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).not.toContain("settle=");
    expect(write.mock.calls[0][1]).toBe(true);
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
