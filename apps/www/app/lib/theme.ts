export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "trygg-theme";
export const THEME_CHANGE_EVENT = "trygg-theme-change";

const THEME_COOKIE_PREFIX = `${THEME_STORAGE_KEY}=`;
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const isTheme = (value: string | null | undefined): value is Theme =>
  value === "dark" || value === "light";

const readThemeCookie = (cookie: string): Theme | null => {
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(THEME_COOKIE_PREFIX));
  const value = entry?.slice(THEME_COOKIE_PREFIX.length);
  return isTheme(value) ? value : null;
};

export const getStoredTheme = (): Theme | null => {
  if (typeof document === "undefined") return null;
  return readThemeCookie(document.cookie);
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
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;

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
  const prefix = storageKey + "=";
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  const stored = entry ? entry.slice(prefix.length) : null;
  const theme = stored === "light" || stored === "dark" ? stored : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;
