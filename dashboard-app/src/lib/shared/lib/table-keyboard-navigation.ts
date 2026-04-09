/**
 * Reusable keyboard navigation hook for data tables.
 * Provides j/k row navigation and Enter to activate.
 */

export type TableKeyboardNav = {
  /** Currently highlighted row index, or -1 if none */
  readonly highlightedIndex: number;
  /** Call this from a keydown handler on the table container */
  handleKeydown: (event: KeyboardEvent) => void;
  /** Reset highlight (e.g. when data changes) */
  reset: () => void;
};

export function createTableKeyboardNav(options: {
  getRowCount: () => number;
  onActivate: (index: number) => void;
  isEnabled?: () => boolean;
}): TableKeyboardNav {
  let _highlightedIndex = -1;

  function isInputFocused(): boolean {
    if (typeof document === "undefined") return false;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      (el as HTMLElement).isContentEditable
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (options.isEnabled && !options.isEnabled()) return;
    if (isInputFocused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const rowCount = options.getRowCount();
    if (rowCount === 0) return;

    if (event.key === "j") {
      event.preventDefault();
      _highlightedIndex = Math.min(_highlightedIndex + 1, rowCount - 1);
      scrollToHighlighted();
    } else if (event.key === "k") {
      event.preventDefault();
      _highlightedIndex = Math.max(_highlightedIndex - 1, 0);
      scrollToHighlighted();
    } else if (event.key === "Enter" && _highlightedIndex >= 0) {
      event.preventDefault();
      options.onActivate(_highlightedIndex);
    }
  }

  function scrollToHighlighted() {
    if (typeof document === "undefined") return;
    const row = document.querySelector(`[data-row-index="${_highlightedIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function reset() {
    _highlightedIndex = -1;
  }

  return {
    get highlightedIndex() {
      return _highlightedIndex;
    },
    handleKeydown,
    reset,
  };
}
