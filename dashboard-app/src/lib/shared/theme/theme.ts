import { setMode } from "mode-watcher";

type BaseMode = "light" | "dark";

type ThemeDefinition<TTheme extends string = string> = {
  id: TTheme;
  label: string;
  baseMode: BaseMode;
  rootClassName?: string;
};

const THEME_DEFINITIONS = [
  {
    id: "light",
    label: "Light",
    baseMode: "light",
    rootClassName: undefined,
  },
  {
    id: "dark",
    label: "Dark",
    baseMode: "dark",
    rootClassName: undefined,
  },
  {
    id: "k9s",
    label: "K9s",
    baseMode: "dark",
    rootClassName: "k9s",
  },
] as const satisfies readonly ThemeDefinition[];

export type AppTheme = (typeof THEME_DEFINITIONS)[number]["id"];

export const APP_THEME_STORAGE_KEY = "kubemaster-app-theme";
export const APP_THEME_ORDER: AppTheme[] = THEME_DEFINITIONS.map((theme) => theme.id);
export const APP_THEME_LABELS = Object.fromEntries(
  THEME_DEFINITIONS.map((theme) => [theme.id, theme.label]),
) as Record<AppTheme, string>;

const THEME_CLASS_NAMES = THEME_DEFINITIONS.flatMap((theme) =>
  theme.rootClassName ? [theme.rootClassName] : [],
);
const THEME_DEFINITION_MAP = new Map<AppTheme, (typeof THEME_DEFINITIONS)[number]>(
  THEME_DEFINITIONS.map((theme) => [theme.id, theme]),
);

export function listAppThemes() {
  return THEME_DEFINITIONS;
}

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  if (!value) return false;
  return THEME_DEFINITION_MAP.has(value as AppTheme);
}

export function resolveTheme(
  value: string | null | undefined,
  fallback: AppTheme = "dark",
): AppTheme {
  return isAppTheme(value) ? value : fallback;
}

export function getThemeDefinition(theme: AppTheme) {
  const fallbackTheme = THEME_DEFINITION_MAP.get("dark");
  if (!fallbackTheme) {
    throw new Error("Dark theme definition is required.");
  }
  return THEME_DEFINITION_MAP.get(theme) ?? fallbackTheme;
}

export function getThemeLabel(theme: AppTheme) {
  return getThemeDefinition(theme).label;
}

export function getNextTheme(currentTheme: AppTheme) {
  const currentIndex = APP_THEME_ORDER.indexOf(currentTheme);
  if (currentIndex === -1) return APP_THEME_ORDER[0];
  return APP_THEME_ORDER[(currentIndex + 1) % APP_THEME_ORDER.length];
}

function readStoredTheme(): AppTheme | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
  return isAppTheme(value) ? value : null;
}

export function detectThemeFromDom(
  root: Element | null = typeof document !== "undefined" ? document.documentElement : null,
): AppTheme {
  if (!root) return "dark";
  for (const theme of THEME_DEFINITIONS) {
    if (theme.rootClassName && root.classList.contains(theme.rootClassName)) {
      return theme.id;
    }
  }
  return root.classList.contains("dark") ? "dark" : "light";
}

export function getInitialTheme(): AppTheme {
  return readStoredTheme() ?? detectThemeFromDom();
}

function syncThemeClasses(root: Element, theme: AppTheme) {
  root.classList.remove(...THEME_CLASS_NAMES);
  const { rootClassName } = getThemeDefinition(theme);
  if (rootClassName) {
    root.classList.add(rootClassName);
  }
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const definition = getThemeDefinition(theme);

  setMode(definition.baseMode);
  syncThemeClasses(root, theme);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  }
}

export function buildThemeBootstrapScript() {
  const serializedThemes = JSON.stringify(
    THEME_DEFINITIONS.map((theme) => ({
      id: theme.id,
      baseMode: theme.baseMode,
      rootClassName: theme.rootClassName ?? null,
    })),
  );

  return `
    try {
      const themes = ${serializedThemes};
      const storageKey = ${JSON.stringify(APP_THEME_STORAGE_KEY)};
      const fallbackTheme = "dark";
      const root = document.documentElement;
      const storedTheme = localStorage.getItem(storageKey);
      const theme = themes.some((item) => item.id === storedTheme) ? storedTheme : fallbackTheme;

      root.classList.remove(...themes.map((item) => item.rootClassName).filter(Boolean));
      root.classList.toggle("dark", themes.find((item) => item.id === theme)?.baseMode === "dark");

      const rootClassName = themes.find((item) => item.id === theme)?.rootClassName;
      if (rootClassName) {
        root.classList.add(rootClassName);
      }
    } catch {
      // ignore theme bootstrap failures
    }
  `;
}
