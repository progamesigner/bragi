import { createEffect, createSignal, onCleanup } from "solid-js";
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

/** Keeps `<html data-theme>` in step with the preference and, for "system", the OS setting. */
export function syncTheme(): void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const [systemDark, setSystemDark] = createSignal(media?.matches ?? true);
  const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
  media?.addEventListener("change", changed);
  onCleanup(() => media?.removeEventListener("change", changed));
  createEffect(() => applyTheme(resolveTheme(themePreference(), systemDark())));
}
