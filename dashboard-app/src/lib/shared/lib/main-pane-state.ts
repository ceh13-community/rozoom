/**
 * What the dashboard main pane shows, as counts and sizes. Pure DOM, no imports, so the
 * e2e suite can load it into a real browser page (layout is what it measures, and jsdom
 * has none). The probe in main-pane-probe.ts writes it to logs.log.
 *
 * Counts and sizes only: no text, names or ids ever leave this module.
 */

export interface MainPaneState {
  visibility: string;
  focused: boolean;
  width: number;
  height: number;
  scrollHeight: number;
  scrollTop: number;
  elements: number;
  /** Characters of rendered text inside the visible part of the pane, capped at TEXT_CAP. */
  text: number;
  invisible: number;
  /** Grid points (of HIT_POINTS) where the topmost element is pane content that shows something. */
  hits: number;
  animations: number;
  center: string;
}

export const HIT_POINTS = 9;
export const TEXT_CAP = 5_000;
// Text nodes looked at before giving up; keeps a megabyte log view from costing seconds.
const TEXT_NODE_LIMIT = 3_000;
const MAX_ELEMENTS = 5_000;
// Opacity and visibility carry down the tree, so the top levels decide whether anything
// below can show. Deeper levels and long sibling lists are skipped to keep it cheap.
const INVISIBLE_SCAN_DEPTH = 4;
const INVISIBLE_SCAN_LIMIT = 200;
// Small hidden bits (hover-only buttons, tooltips) are normal. Only an invisible block
// covering a large part of the pane can blank it.
const INVISIBLE_MIN_SHARE = 0.25;
// Below this the text is there but nobody can read it.
const MIN_OPACITY = 0.05;
const GRID = [1 / 6, 1 / 2, 5 / 6];
const SHOW_TEXT = 0x4;
const TEXT_NODE = 3;
const SVG_NS = "http://www.w3.org/2000/svg";
const MEDIA_TAGS = new Set(["IMG", "CANVAS", "VIDEO"]);

type Box = { left: number; top: number; right: number; bottom: number };

/** The part of the pane inside the window, or null when none of it is. */
function visibleBox(main: HTMLElement, view: Window): Box | null {
  const rect = main.getBoundingClientRect();
  const box = {
    left: Math.max(rect.left, 0),
    top: Math.max(rect.top, 0),
    right: Math.min(rect.right, view.innerWidth),
    bottom: Math.min(rect.bottom, view.innerHeight),
  };
  return box.right - box.left >= 1 && box.bottom - box.top >= 1 ? box : null;
}

function overlaps(rect: DOMRect, box: Box): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > box.left &&
    rect.left < box.right &&
    rect.bottom > box.top &&
    rect.top < box.bottom
  );
}

/**
 * Opacity does not inherit in computed style, so a text node is readable only if no
 * element between it and the pane is (nearly) transparent. Memoised per element: text
 * nodes share most of their ancestors.
 */
function createOpacityCheck(main: HTMLElement, view: Window): (element: Element) => boolean {
  const known = new Map<Element, boolean>();
  const isOpaque = (element: Element): boolean => {
    const cached = known.get(element);
    if (cached !== undefined) return cached;
    const own = Number.parseFloat(view.getComputedStyle(element).opacity) >= MIN_OPACITY;
    const parent = element.parentElement;
    const result = own && (element === main || !parent || isOpaque(parent));
    known.set(element, result);
    return result;
  };
  return isOpaque;
}

/**
 * Rendered, readable text inside the pane's visible box. A node under display:none has
 * no client rects, one moved out of the pane has none inside the box, and one under a
 * transparent or visibility:hidden ancestor is skipped, so none of them count. Clipping
 * (overflow, clip-path) does not change the rects; `hits` covers that.
 */
function countVisibleText(main: HTMLElement, doc: Document, view: Window, box: Box | null) {
  if (!box) return 0;
  const isOpaque = createOpacityCheck(main, view);
  const walker = doc.createTreeWalker(main, SHOW_TEXT);
  const range = doc.createRange();
  let length = 0;
  let seen = 0;
  while (length < TEXT_CAP && seen < TEXT_NODE_LIMIT) {
    const node = walker.nextNode();
    if (!node) break;
    const text = (node.nodeValue ?? "").trim();
    if (!text) continue;
    seen += 1;
    const parent = node.parentElement;
    if (!parent || view.getComputedStyle(parent).visibility !== "visible") continue;
    if (!isOpaque(parent)) continue;
    range.selectNodeContents(node);
    if (Array.from(range.getClientRects()).some((rect) => overlaps(rect, box))) {
      length += text.length;
    }
  }
  return Math.min(length, TEXT_CAP);
}

function isTransparent(color: string): boolean {
  const compact = color.replace(/\s/g, "");
  return compact === "transparent" || /^rgba\(.*,0(\.0+)?\)$/.test(compact);
}

/** The colour seen behind the pane: a wrapper painted in it looks as blank as nothing. */
function backgroundBehind(main: HTMLElement, view: Window): string {
  for (let node: Element | null = main; node; node = node.parentElement) {
    const color = view.getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) return color;
  }
  return "transparent";
}

function showsSomething(element: Element, view: Window, behind: string): boolean {
  if (element.namespaceURI === SVG_NS || MEDIA_TAGS.has(element.tagName)) return true;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === TEXT_NODE && (child.nodeValue ?? "").trim()) return true;
  }
  const style = view.getComputedStyle(element);
  if (style.backgroundImage !== "none") return true;
  return !isTransparent(style.backgroundColor) && style.backgroundColor !== behind;
}

/**
 * Hit-tests a 3x3 grid over the visible part of the pane. Hit testing follows what the
 * engine would paint (display, visibility, overflow and clip-path clipping, stacking), so
 * a pane whose content is in the DOM but not shown scores 0. A pane that scores well and
 * still looks blank to the user points at WebKit losing the paint, not at the page.
 */
function countHits(main: HTMLElement, doc: Document, view: Window, box: Box | null): number {
  if (!box) return 0;
  const behind = backgroundBehind(main, view);
  let hits = 0;
  for (const fy of GRID) {
    for (const fx of GRID) {
      const hit = doc.elementFromPoint(
        box.left + (box.right - box.left) * fx,
        box.top + (box.bottom - box.top) * fy,
      );
      if (hit && hit !== main && main.contains(hit) && showsSomething(hit, view, behind)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function countInvisible(main: HTMLElement, view: Window): number {
  const minArea = main.clientWidth * main.clientHeight * INVISIBLE_MIN_SHARE;
  let checked = 0;
  let invisible = 0;

  const visit = (element: Element, depth: number) => {
    if (checked >= INVISIBLE_SCAN_LIMIT) return;
    checked += 1;
    const style = view.getComputedStyle(element);
    if (Number.parseFloat(style.opacity) < MIN_OPACITY || style.visibility === "hidden") {
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

function describeCenter(main: HTMLElement, doc: Document, box: Box | null): string {
  if (!box) return "none";
  const hit = doc.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  if (!hit) return "none";
  if (hit === main) return "main";
  if (main.contains(hit)) return "content";
  // Something outside the pane sits on top of it, for example an overlay left open.
  const slot = hit.getAttribute("data-slot");
  return `outside:${hit.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}`;
}

function countAnimations(main: HTMLElement, doc: Document): number {
  return doc.getAnimations().filter((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && main.contains(target);
  }).length;
}

export function describeMainPane(main: HTMLElement, doc: Document = document): MainPaneState {
  const view = doc.defaultView ?? window;
  const box = visibleBox(main, view);
  return {
    visibility: doc.visibilityState,
    focused: doc.hasFocus(),
    width: Math.round(main.clientWidth),
    height: Math.round(main.clientHeight),
    scrollHeight: Math.round(main.scrollHeight),
    scrollTop: Math.round(main.scrollTop),
    elements: Math.min(main.getElementsByTagName("*").length, MAX_ELEMENTS),
    text: countVisibleText(main, doc, view, box),
    invisible: countInvisible(main, view),
    hits: countHits(main, doc, view, box),
    animations: countAnimations(main, doc),
    center: describeCenter(main, doc, box),
  };
}

/**
 * A state worth a warn line: the pane would look blank to the user. `center` is not part
 * of it: a short page leaves the centre empty, and an open sheet covers it on purpose.
 */
export function looksBlank(state: MainPaneState): boolean {
  if (state.visibility !== "visible") return false;
  return state.elements === 0 || state.text === 0 || state.invisible > 0 || state.hits === 0;
}

export type ProbeTrigger = "navigate" | "visible" | "focus";

const WORKLOAD_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Route for the line: the SvelteKit pattern, plus the workload when it is a plain slug. */
export function probeRoute(routeId: string | null, workload: string | null): string {
  const base = routeId ?? "unknown";
  if (!workload) return base;
  return `${base}?workload=${WORKLOAD_PATTERN.test(workload) ? workload : "other"}`;
}

export function formatMainPaneLine(
  state: MainPaneState,
  route: string,
  trigger: ProbeTrigger,
): string {
  return [
    `[main-pane] trigger=${trigger}`,
    `route=${route}`,
    `visibility=${state.visibility}`,
    `focus=${state.focused ? 1 : 0}`,
    `size=${state.width}x${state.height}`,
    `scroll=${state.scrollTop}/${state.scrollHeight}`,
    `elements=${state.elements}`,
    `text=${state.text}${state.text >= TEXT_CAP ? "+" : ""}`,
    `invisible=${state.invisible}`,
    `hits=${state.hits}/${HIT_POINTS}`,
    `animations=${state.animations}`,
    `center=${state.center}`,
  ].join(" ");
}
