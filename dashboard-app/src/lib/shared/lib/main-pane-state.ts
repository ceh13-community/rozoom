/**
 * What the dashboard main pane shows, as counts and sizes. Pure DOM, no imports, so the
 * e2e suite can load it into a real browser page (layout is what it measures, and jsdom
 * has none). The probe in main-pane-probe.ts writes it to logs.log.
 *
 * Counts and sizes only: no page text, resource names or ids ever leave this module. A
 * layer over the pane is named by its tag, role and data-attribute names (never values),
 * which the app and its libraries define.
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
  /** Grid points where the topmost element is outside the pane: a sheet, dialog or toast. */
  covered: number;
  animations: number;
  center: string;
  /**
   * The layer whose element is topmost at the centre when that is outside the pane: the
   * nearest positioned ancestor with a z-index, as tag, role, data-attribute names and
   * z-index. "root" when nothing in the body takes the point (pointer events off), "none"
   * when the pane itself is on top.
   */
  layer: string;
  /** pointer-events of <body>: a menu or dialog sets "none" while it is open. */
  bodyPointer: string;
}

export const HIT_POINTS = 25;
export const TEXT_CAP = 5_000;
// Text nodes looked at before giving up; keeps a megabyte log view from costing seconds.
const TEXT_NODE_LIMIT = 3_000;
// Text nodes in a row that lie wholly below the visible box before the walk stops. Not 1:
// absolutely positioned or reordered content can come later in the DOM but sit higher.
const BELOW_BOX_STOP = 50;
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
// 5x5: on short pages (an empty list under a banner) a 3x3 grid hit content at 1 to 3
// points, too thin a margin above zero; 5x5 hits 6 to 9 there.
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
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
  let belowInARow = 0;
  while (length < TEXT_CAP && seen < TEXT_NODE_LIMIT && belowInARow < BELOW_BOX_STOP) {
    const node = walker.nextNode();
    if (!node) break;
    const text = (node.nodeValue ?? "").trim();
    if (!text) continue;
    seen += 1;
    const parent = node.parentElement;
    if (!parent || view.getComputedStyle(parent).visibility !== "visible") continue;
    if (!isOpaque(parent)) continue;
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    // A node without rects (display:none) says nothing about where the walk is.
    if (rects.length === 0) continue;
    if (rects.some((rect) => overlaps(rect, box))) {
      length += text.length;
      belowInARow = 0;
    } else if (rects.every((rect) => rect.top >= box.bottom)) {
      belowInARow += 1;
    } else {
      belowInARow = 0;
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
 * Hit-tests a 5x5 grid over the visible part of the pane. Hit testing follows what the
 * engine would paint (display, visibility, overflow and clip-path clipping, stacking), so
 * a pane whose content is in the DOM but not shown scores 0. A pane that scores well and
 * still looks blank to the user points at WebKit losing the paint, not at the page.
 * Points whose topmost element is outside the pane are counted apart as covered.
 */
function countHits(
  main: HTMLElement,
  doc: Document,
  view: Window,
  box: Box | null,
): { hits: number; covered: number } {
  if (!box) return { hits: 0, covered: 0 };
  const behind = backgroundBehind(main, view);
  let hits = 0;
  let covered = 0;
  for (const fy of GRID) {
    for (const fx of GRID) {
      const hit = doc.elementFromPoint(
        box.left + (box.right - box.left) * fx,
        box.top + (box.bottom - box.top) * fy,
      );
      if (!hit) continue;
      if (!main.contains(hit)) covered += 1;
      else if (hit !== main && showsSomething(hit, view, behind)) hits += 1;
    }
  }
  return { hits, covered };
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

function centerHit(doc: Document, box: Box | null): Element | null {
  if (!box) return null;
  return doc.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
}

function describeCenter(main: HTMLElement, hit: Element | null): string {
  if (!hit) return "none";
  if (hit === main) return "main";
  if (main.contains(hit)) return "content";
  // Something outside the pane sits on top of it, for example an overlay left open.
  const slot = hit.getAttribute("data-slot");
  return `outside:${hit.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}`;
}

const DATA_NAME = /^data-[a-z][a-z0-9-]{0,40}$/;
const WORD = /^[a-z-]{1,20}$/;
const LAYER_DATA_NAMES = 3;

/** Which layer covers the centre of the pane; see MainPaneState.layer. */
export function describeLayer(main: HTMLElement, hit: Element | null, view: Window): string {
  if (!hit || main.contains(hit)) return "none";
  const doc = hit.ownerDocument;
  if (hit === doc.documentElement) return "root";
  let layer: Element | null = hit;
  let style: CSSStyleDeclaration | null = null;
  while (layer && layer !== doc.body && layer !== doc.documentElement) {
    style = view.getComputedStyle(layer);
    const positioned = style.position !== "" && style.position !== "static";
    if (positioned && Number.isFinite(Number.parseInt(style.zIndex, 10))) break;
    layer = layer.parentElement;
  }
  if (!layer || !style || layer === doc.body || layer === doc.documentElement) {
    return `${hit.tagName.toLowerCase()}:in-flow`;
  }
  const parts = [layer.tagName.toLowerCase()];
  const role = layer.getAttribute("role");
  if (role && WORD.test(role)) parts.push(`role-${role}`);
  const dataNames = Array.from(layer.attributes)
    .map((attribute) => attribute.name)
    .filter((name) => DATA_NAME.test(name))
    .slice(0, LAYER_DATA_NAMES);
  parts.push(...dataNames);
  parts.push(`z${Number.parseInt(style.zIndex, 10) || 0}`);
  return parts.join(":");
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
  const { hits, covered } = countHits(main, doc, view, box);
  const hit = centerHit(doc, box);
  const bodyPointer = view.getComputedStyle(doc.body).pointerEvents;
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
    hits,
    covered,
    animations: countAnimations(main, doc),
    center: describeCenter(main, hit),
    layer: describeLayer(main, hit, view),
    bodyPointer: WORD.test(bodyPointer) ? bodyPointer : "other",
  };
}

/**
 * A state worth a warn line: the pane would look blank to the user. `center` is not part
 * of it: a short page leaves the centre empty. Zero hits counts only while some point is
 * uncovered: a modal sheet or dialog over the whole pane takes every point on purpose,
 * while a toast in one corner must not switch the check off.
 */
export function looksBlank(state: MainPaneState): boolean {
  if (state.visibility !== "visible") return false;
  const shownNothing = state.hits === 0 && state.covered < HIT_POINTS;
  return state.elements === 0 || state.text === 0 || state.invisible > 0 || shownNothing;
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
    `covered=${state.covered}/${HIT_POINTS}`,
    `animations=${state.animations}`,
    `center=${state.center}`,
    `layer=${state.layer}`,
    `body-pointer=${state.bodyPointer}`,
  ].join(" ");
}
