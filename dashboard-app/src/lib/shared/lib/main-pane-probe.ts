import { info, warn } from "@tauri-apps/plugin-log";
import { isTauriAvailable } from "./tauri-runtime";

/**
 * One logs.log line describing what the main pane holds, written a few seconds after
 * each navigation and when the window comes back after a while away.
 *
 * A main pane that shows only the background colour (sidebar fine) was reported after a
 * reconnect and never reproduced on a test stand. Uncaught JS errors already reach
 * logs.log (js-error-log.ts); this line answers the rest without devtools. At the moment
 * the user saw the blank pane, was the DOM empty, was it there but invisible (opacity,
 * visibility, a stuck animation, something covering it), or was it there and visible
 * to the page, which leaves WebKit losing the paint.
 *
 * Counts and sizes only: no text, names or ids. The route is the pattern, not the URL.
 */

export type ProbeTrigger = "navigate" | "visible" | "focus";

export interface MainPaneState {
  visibility: string;
  focused: boolean;
  width: number;
  height: number;
  scrollHeight: number;
  scrollTop: number;
  elements: number;
  textLength: number;
  invisible: number;
  animations: number;
  center: string;
}

const MAX_ELEMENTS = 5_000;
// Opacity and visibility carry down the tree, so the top levels decide whether anything
// below can show. Deeper levels and long sibling lists are skipped to keep it cheap.
const INVISIBLE_SCAN_DEPTH = 4;
const INVISIBLE_SCAN_LIMIT = 200;
// Small hidden bits (hover-only buttons, tooltips) are normal. Only an invisible block
// covering a large part of the pane can blank it.
const INVISIBLE_MIN_SHARE = 0.25;

function countInvisible(main: HTMLElement, view: Window): number {
  const minArea = main.clientWidth * main.clientHeight * INVISIBLE_MIN_SHARE;
  let checked = 0;
  let invisible = 0;

  const visit = (element: Element, depth: number) => {
    if (checked >= INVISIBLE_SCAN_LIMIT) return;
    checked += 1;
    const style = view.getComputedStyle(element);
    if (Number.parseFloat(style.opacity) < 0.05 || style.visibility === "hidden") {
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height >= minArea) invisible += 1;
      // Everything below an invisible element is invisible too; count it once.
      return;
    }
    if (depth === INVISIBLE_SCAN_DEPTH) return;
    for (const child of Array.from(element.children)) visit(child, depth + 1);
  };

  visit(main, 0);
  return invisible;
}

function describeCenter(main: HTMLElement, doc: Document): string {
  // Not implemented in every DOM (jsdom has none).
  if (typeof doc.elementFromPoint !== "function") return "unknown";
  const rect = main.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "none";
  const hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return "none";
  if (hit === main) return "main";
  if (main.contains(hit)) return "content";
  // Something outside the pane sits on top of it, for example an overlay left open.
  const slot = hit.getAttribute("data-slot");
  return `outside:${hit.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}`;
}

function countAnimations(main: HTMLElement, doc: Document): number {
  if (typeof doc.getAnimations !== "function") return 0;
  return doc.getAnimations().filter((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && main.contains(target);
  }).length;
}

export function describeMainPane(main: HTMLElement, doc: Document = document): MainPaneState {
  const view = doc.defaultView ?? window;
  return {
    visibility: doc.visibilityState,
    focused: doc.hasFocus(),
    width: Math.round(main.clientWidth),
    height: Math.round(main.clientHeight),
    scrollHeight: Math.round(main.scrollHeight),
    scrollTop: Math.round(main.scrollTop),
    elements: Math.min(main.getElementsByTagName("*").length, MAX_ELEMENTS),
    textLength: (main.textContent ?? "").trim().length,
    invisible: countInvisible(main, view),
    animations: countAnimations(main, doc),
    center: describeCenter(main, doc),
  };
}

/** A state worth a warn line: the pane would look blank to the user. */
export function looksBlank(state: MainPaneState): boolean {
  if (state.visibility !== "visible") return false;
  return (
    state.elements === 0 ||
    state.textLength === 0 ||
    state.invisible > 0 ||
    state.center === "main" ||
    state.center.startsWith("outside:")
  );
}

export function formatMainPaneLine(
  state: MainPaneState,
  route: string | null,
  trigger: ProbeTrigger,
): string {
  return [
    `[main-pane] trigger=${trigger}`,
    `route=${route ?? "unknown"}`,
    `visibility=${state.visibility}`,
    `focus=${state.focused ? 1 : 0}`,
    `size=${state.width}x${state.height}`,
    `scroll=${state.scrollTop}/${state.scrollHeight}`,
    `elements=${state.elements}`,
    `text=${state.textLength}`,
    `invisible=${state.invisible}`,
    `animations=${state.animations}`,
    `center=${state.center}`,
  ].join(" ");
}

export const NAVIGATE_DELAY_MS = 3_000;
export const RESTORE_DELAY_MS = 1_000;
/** Shorter absences are ordinary window switching and not worth a line. */
export const MIN_AWAY_MS = 30_000;

interface ProbeOptions {
  getMain: () => HTMLElement | null | undefined;
  getRoute: () => string | null;
  write: (line: string, blank: boolean) => unknown;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  describe?: (main: HTMLElement) => MainPaneState;
}

export interface MainPaneProbe {
  navigated(): void;
  hidden(): void;
  shown(trigger: Exclude<ProbeTrigger, "navigate">): void;
  dispose(): void;
}

export function createMainPaneProbe({
  getMain,
  getRoute,
  write,
  now = Date.now,
  schedule = (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
  describe = (main) => describeMainPane(main),
}: ProbeOptions): MainPaneProbe {
  let cancelPending: (() => void) | null = null;
  let awaySince: number | null = null;

  function probeLater(trigger: ProbeTrigger, delayMs: number) {
    cancelPending?.();
    cancelPending = schedule(() => {
      cancelPending = null;
      const main = getMain();
      if (!main) return;
      try {
        const state = describe(main);
        void Promise.resolve(
          write(formatMainPaneLine(state, getRoute(), trigger), looksBlank(state)),
        ).catch(() => undefined);
      } catch {
        // A diagnostic must never break the page it describes.
      }
    }, delayMs);
  }

  return {
    navigated() {
      probeLater("navigate", NAVIGATE_DELAY_MS);
    },
    hidden() {
      awaySince ??= now();
    },
    shown(trigger) {
      const since = awaySince;
      awaySince = null;
      if (since === null || now() - since < MIN_AWAY_MS) return;
      probeLater(trigger, RESTORE_DELAY_MS);
    },
    dispose() {
      cancelPending?.();
      cancelPending = null;
    },
  };
}

/**
 * Wires the probe to the window. Returns the probe (call `navigated()` from the layout's
 * afterNavigate) and a cleanup. Outside Tauri there is no logs.log, so nothing is wired.
 */
export function installMainPaneProbe(
  getMain: ProbeOptions["getMain"],
  getRoute: ProbeOptions["getRoute"],
  target: Window = window,
): { probe: MainPaneProbe; dispose: () => void } {
  const probe = createMainPaneProbe({
    getMain,
    getRoute,
    write: (line, blank) => (blank ? warn(line) : info(line)),
  });
  if (!isTauriAvailable()) {
    return {
      probe: { ...probe, navigated() {} },
      dispose: () => {
        probe.dispose();
      },
    };
  }

  const doc = target.document;
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") probe.hidden();
    else probe.shown("visible");
  };
  // On Wayland, GTK3 minimize does not set document.hidden, so blur/focus is the only
  // signal that the window was away.
  const onBlur = () => {
    probe.hidden();
  };
  const onFocus = () => {
    probe.shown("focus");
  };

  doc.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("blur", onBlur);
  target.addEventListener("focus", onFocus);
  return {
    probe,
    dispose: () => {
      doc.removeEventListener("visibilitychange", onVisibility);
      target.removeEventListener("blur", onBlur);
      target.removeEventListener("focus", onFocus);
      probe.dispose();
    },
  };
}
