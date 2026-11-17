import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import {
  createMainPaneProbe,
  describeMainPane,
  formatMainPaneLine,
  looksBlank,
  MIN_AWAY_MS,
  NAVIGATE_DELAY_MS,
  RESTORE_DELAY_MS,
  type MainPaneState,
} from "./main-pane-probe";

function mountMain(html: string): HTMLElement {
  const main = document.createElement("main");
  main.innerHTML = html;
  document.body.appendChild(main);
  return main;
}

const healthy: MainPaneState = {
  visibility: "visible",
  focused: true,
  width: 1180,
  height: 820,
  scrollHeight: 2400,
  scrollTop: 0,
  elements: 900,
  textLength: 5000,
  invisible: 0,
  animations: 0,
  center: "content",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("describeMainPane", () => {
  it("reports an empty pane", () => {
    const state = describeMainPane(mountMain(""));
    expect(state.elements).toBe(0);
    expect(state.textLength).toBe(0);
    expect(state.invisible).toBe(0);
  });

  it("counts content without reading it into the line", () => {
    const main = mountMain("<section><h1>prod-eu-payments</h1><p>pod-7f9c</p></section>");
    const state = describeMainPane(main);
    expect(state.elements).toBe(3);
    expect(state.textLength).toBe("prod-eu-paymentspod-7f9c".length);

    const line = formatMainPaneLine(state, "/dashboard/clusters/[slug]?workload=pods", "navigate");
    expect(line).not.toContain("prod-eu-payments");
    expect(line).not.toContain("pod-7f9c");
    expect(line).toContain("elements=3");
    expect(line).toContain("route=/dashboard/clusters/[slug]?workload=pods");
  });

  it("counts an invisible block once, not every element under it", () => {
    const main = mountMain(
      '<div style="opacity: 0"><table><tr><td>a</td></tr></table></div><div>shown</div>',
    );
    expect(describeMainPane(main).invisible).toBe(1);
  });

  it("counts visibility hidden as invisible", () => {
    const main = mountMain('<div style="visibility: hidden">x</div>');
    expect(describeMainPane(main).invisible).toBe(1);
  });

  it("names an overlay sitting on top of the pane", () => {
    const main = mountMain("<p>rows</p>");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-slot", "dialog-overlay");
    document.body.appendChild(overlay);
    vi.spyOn(main, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => overlay),
    });
    try {
      expect(describeMainPane(main).center).toBe("outside:div[dialog-overlay]");
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});

describe("looksBlank", () => {
  it("is false for a pane with visible content", () => {
    expect(looksBlank(healthy)).toBe(false);
  });

  it.each([
    ["no elements", { elements: 0 }],
    ["no text", { textLength: 0 }],
    ["an invisible block", { invisible: 1 }],
  ])("is true with %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(true);
  });

  it.each([
    ["a short page with nothing at the centre", { center: "main" }],
    ["a sheet open over the pane", { center: "outside:div[dialog-overlay]" }],
  ])("is false for %s", (_, change) => {
    expect(looksBlank({ ...healthy, ...change })).toBe(false);
  });

  it("is false while the window is hidden", () => {
    expect(looksBlank({ ...healthy, visibility: "hidden", elements: 0 })).toBe(false);
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
      getRoute: () => null,
      write: () => Promise.reject(new Error("log plugin gone")),
      schedule: (callback) => {
        callback();
        return () => undefined;
      },
      describe: () => {
        throw new Error("layout read failed");
      },
    });
    expect(() => failing.navigated()).not.toThrow();
  });

  it("cancels a pending probe on dispose", () => {
    const { probe, write, flush } = setup();
    probe.navigated();
    probe.dispose();
    flush();
    expect(write).not.toHaveBeenCalled();
  });
});
