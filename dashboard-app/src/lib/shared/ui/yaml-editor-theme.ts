import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { getThemeDefinition, type AppTheme } from "$shared/theme";

type SyntaxToken =
  | "key"
  | "string"
  | "number"
  | "bool"
  | "null"
  | "comment"
  | "keyword"
  | "operator"
  | "punctuation"
  | "meta";

// Every color is verified at >= 4.5:1 (WCAG AA) against its theme's
// --background in yaml-editor-theme.test.ts. Keep the test in sync when
// changing values here or theme backgrounds in app/styles/index.css.
const DARK_PALETTE: Record<SyntaxToken, string> = {
  key: "#7dd3fc", // sky-300
  string: "#fde68a", // amber-200
  number: "#c4b5fd", // violet-300
  bool: "#f9a8d4", // pink-300
  null: "#94a3b8", // slate-400
  comment: "#6ee7b7", // emerald-300
  keyword: "#93c5fd", // blue-300
  operator: "#cbd5e1", // slate-300
  punctuation: "#94a3b8", // slate-400
  meta: "#94a3b8", // slate-400
};

export const YAML_SYNTAX_PALETTES: Record<AppTheme, Record<SyntaxToken, string>> = {
  dark: DARK_PALETTE,
  light: {
    key: "#1d4ed8", // blue-700
    string: "#b45309", // amber-700
    number: "#6d28d9", // violet-700
    bool: "#be185d", // pink-700
    null: "#64748b", // slate-500
    comment: "#047857", // emerald-700
    keyword: "#2563eb", // blue-600
    operator: "#475569", // slate-600
    punctuation: "#64748b", // slate-500
    meta: "#64748b", // slate-500
  },
  // Near-black background makes the dark palette even safer contrast-wise;
  // only the keyword tone shifts to amber to match the k9s accent (--primary).
  k9s: {
    ...DARK_PALETTE,
    keyword: "#fcd34d", // amber-300
  },
};

const highlightCache = new Map<AppTheme, HighlightStyle>();

export function yamlSyntaxHighlight(theme: AppTheme): HighlightStyle {
  let style = highlightCache.get(theme);
  if (!style) {
    const palette = YAML_SYNTAX_PALETTES[theme];
    style = HighlightStyle.define([
      { tag: tags.propertyName, color: palette.key },
      { tag: tags.string, color: palette.string },
      { tag: tags.number, color: palette.number },
      { tag: tags.bool, color: palette.bool },
      { tag: tags.null, color: palette.null },
      { tag: tags.comment, color: palette.comment },
      { tag: tags.keyword, color: palette.keyword },
      { tag: tags.operator, color: palette.operator },
      { tag: tags.punctuation, color: palette.punctuation },
      { tag: tags.meta, color: palette.meta },
    ]);
    highlightCache.set(theme, style);
  }
  return style;
}

export function isDarkEditorTheme(theme: AppTheme): boolean {
  return getThemeDefinition(theme).baseMode === "dark";
}
