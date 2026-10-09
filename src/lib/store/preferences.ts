import { createEffect, createSignal, onCleanup } from "solid-js";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALES, type Locale } from "../i18n/locales";
import {
  applyTheme,
  resolveTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../theme";
import { readChoice, writeString } from "./persist";

const [themePreference, setThemePreferenceSignal] = createSignal<ThemePreference>(
  readChoice(THEME_STORAGE_KEY, THEME_PREFERENCES, "system"),
);

export { themePreference };

/** Takes effect immediately on every screen. */
export function setThemePreference(preference: ThemePreference): void {
  setThemePreferenceSignal(preference);
  writeString(THEME_STORAGE_KEY, preference);
}

const [locale, setLocaleSignal] = createSignal<Locale>(
  readChoice(LOCALE_STORAGE_KEY, LOCALES, DEFAULT_LOCALE),
);

export { locale };

/** Takes effect immediately; text the user or Gemini wrote is never translated. */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  writeString(LOCALE_STORAGE_KEY, next);
}

/**
 * Keeps `<html data-theme>` in step with the theme preference (and, for "system", the OS) and
 * `<html lang>` in step with the interface language.
 */
export function syncDocument(): void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const [systemDark, setSystemDark] = createSignal(media?.matches ?? true);
  const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
  media?.addEventListener("change", changed);
  onCleanup(() => media?.removeEventListener("change", changed));
  createEffect(() => applyTheme(resolveTheme(themePreference(), systemDark())));
  createEffect(() => {
    document.documentElement.lang = locale();
  });
}
