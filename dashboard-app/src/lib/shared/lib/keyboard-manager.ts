/**
 * Global keyboard shortcut manager.
 *
 * Supports:
 * - Simple shortcuts: "mod+k", "/", "escape"
 * - Chord sequences: "g d" (press g, then d within timeout)
 * - Platform-aware modifier: "mod" maps to Meta on macOS, Ctrl elsewhere
 * - Input focus guard: shortcuts are suppressed when an input/textarea is focused
 * - Overlay escape stack: Escape closes the topmost registered overlay
 */

const CHORD_TIMEOUT_MS = 800;

type ShortcutHandler = () => void;
type ShortcutGuard = () => boolean;

interface ShortcutRegistration {
  combo: string;
  handler: ShortcutHandler;
  when?: ShortcutGuard;
}

let registrations: ShortcutRegistration[] = [];
let chordBuffer: string | null = null;
let chordTimer: ReturnType<typeof setTimeout> | null = null;
let overlayStack: Array<{ id: string; close: () => void }> = [];

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function normalizeCombo(combo: string): string {
  return combo.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesKeyEvent(combo: string, event: KeyboardEvent): boolean {
  const parts = combo.split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  const needsMod = modifiers.includes("mod");
  const needsShift = modifiers.includes("shift");
  const needsAlt = modifiers.includes("alt");

  const modPressed = isMac() ? event.metaKey : event.ctrlKey;

  if (needsMod && !modPressed) return false;
  if (!needsMod && modPressed) return false;
  if (needsShift !== event.shiftKey) return false;
  if (needsAlt !== event.altKey) return false;

  return event.key.toLowerCase() === key;
}

function isChordCombo(combo: string): boolean {
  return combo.includes(" ") && !combo.includes("+");
}

function clearChord(): void {
  chordBuffer = null;
  if (chordTimer !== null) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
}

export function registerShortcut(
  combo: string,
  handler: ShortcutHandler,
  when?: ShortcutGuard,
): () => void {
  const registration: ShortcutRegistration = {
    combo: normalizeCombo(combo),
    handler,
    when,
  };
  registrations.push(registration);
  return () => {
    registrations = registrations.filter((r) => r !== registration);
  };
}

export function pushOverlay(id: string, close: () => void): () => void {
  overlayStack.push({ id, close });
  return () => {
    overlayStack = overlayStack.filter((o) => o.id !== id);
  };
}

export function handleGlobalKeydown(event: KeyboardEvent): void {
  // Escape always works - closes topmost overlay
  if (event.key === "Escape" && overlayStack.length > 0) {
    event.preventDefault();
    const topmost = overlayStack[overlayStack.length - 1];
    topmost.close();
    overlayStack = overlayStack.filter((o) => o.id !== topmost.id);
    return;
  }

  // Check modifier-based shortcuts (work even in inputs for mod+k)
  for (const reg of registrations) {
    if (isChordCombo(reg.combo)) continue;
    if (!matchesKeyEvent(reg.combo, event)) continue;
    if (reg.when && !reg.when()) continue;

    // mod+key shortcuts work even in inputs
    const hasModifier = reg.combo.includes("mod+");
    if (!hasModifier && isInputFocused()) continue;

    event.preventDefault();
    reg.handler();
    clearChord();
    return;
  }

  // Single-key shortcuts and chords - skip when input is focused or modifier held
  if (isInputFocused()) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const pressedKey = event.key.toLowerCase();

  // Check if this completes a chord
  if (chordBuffer !== null) {
    const chord = `${chordBuffer} ${pressedKey}`;
    clearChord();

    for (const reg of registrations) {
      if (reg.combo !== chord) continue;
      if (reg.when && !reg.when()) continue;
      event.preventDefault();
      reg.handler();
      return;
    }
    // Chord didn't match - fall through to check single-key
  }

  // Check if this starts a chord
  const startsChord = registrations.some(
    (r) => isChordCombo(r.combo) && r.combo.startsWith(pressedKey + " "),
  );
  if (startsChord) {
    chordBuffer = pressedKey;
    chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
    return;
  }

  // Check single-key shortcuts
  for (const reg of registrations) {
    if (isChordCombo(reg.combo)) continue;
    if (reg.combo !== pressedKey) continue;
    if (reg.when && !reg.when()) continue;
    event.preventDefault();
    reg.handler();
    return;
  }
}

/** Reset all state - useful for testing */
export function resetKeyboardManager(): void {
  registrations = [];
  overlayStack = [];
  clearChord();
}
