export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "bragi-theme";

/** Browser chrome colour per theme; matches `--bg` in styles.css. */
export const THEME_COLORS: Record<Theme, string> = { dark: "#171512", light: "#f6f1e7" };

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Applies the resolved theme to `<html data-theme>` and the browser's theme colour. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}
