import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type ThemeId = "light" | "dark" | "k9s";

const STORAGE_KEY = "rozoom-mobile-theme";
const THEME_ORDER: ThemeId[] = ["light", "dark", "k9s"];

function getInitial(): ThemeId {
  if (!browser) return "dark";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && THEME_ORDER.includes(stored as ThemeId)) return stored as ThemeId;
  return "dark";
}

function createThemeStore() {
  const { subscribe, set, update } = writable<ThemeId>(getInitial());

  function apply(id: ThemeId) {
    if (browser) {
      document.documentElement.setAttribute("data-theme", id);
      localStorage.setItem(STORAGE_KEY, id);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        const style = getComputedStyle(document.documentElement);
        meta.setAttribute("content", style.getPropertyValue("--status-bar").trim());
      }
    }
  }

  subscribe(apply);

  return {
    subscribe,
    set(id: ThemeId) {
      set(id);
    },
    cycle() {
      update((current) => {
        const idx = THEME_ORDER.indexOf(current);
        return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      });
    },
  };
}

export const theme = createThemeStore();
