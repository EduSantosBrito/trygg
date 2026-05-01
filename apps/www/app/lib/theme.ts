export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "trygg-theme";
export const THEME_CHANGE_EVENT = "trygg-theme-change";

const isTheme = (value: string | null | undefined): value is Theme =>
  value === "dark" || value === "light";

export const getStoredTheme = (): Theme | null => {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : null;
};

export const DEFAULT_THEME: Theme = "light";

export const getSystemTheme = (): Theme => {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

export const getTheme = (): Theme => {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.theme;
    if (isTheme(current)) return current;
  }
  return getStoredTheme() ?? DEFAULT_THEME;
};

export const themeColor = (theme: Theme) =>
  theme === "dark" ? "oklch(16% 0.01 50)" : "oklch(97% 0.005 70)";

export const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta instanceof HTMLMetaElement) {
    meta.content = themeColor(theme);
  }
};

export const setTheme = (theme: Theme) => {
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
};

export const toggleTheme = (): Theme => {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
};

export const themeInitScript = `(() => {
  const storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
  const stored = localStorage.getItem(storageKey);
  const theme = stored === "light" || stored === "dark" ? stored : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;
