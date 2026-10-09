import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALES, type Locale } from "../i18n/locales";
import {
  applyTheme,
  resolveTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../theme";
import { readChoice, readString, writeString } from "./persist";

/**
 * Device preferences. They live for the whole app, not in any screen, so moving between capture,
 * review and playback never resets them, and each is saved to localStorage when it changes.
 *
 * When a change takes effect:
 * - "immediately": every screen re-renders with the new value at once.
 * - "next-playback": audio already playing or prepared keeps its settings; the next playback
 *   action (play, next, retry, preview) reads the new value through `playbackSettings()`.
 */
export const PREFERENCE_APPLIES = {
  theme: "immediately",
  locale: "immediately",
  fontSize: "immediately",
  keepAwake: "immediately",
  voice: "next-playback",
  playbackRate: "next-playback",
} as const satisfies Record<string, "immediately" | "next-playback">;

export const STORAGE_KEYS = {
  theme: THEME_STORAGE_KEY,
  locale: LOCALE_STORAGE_KEY,
  fontSize: "bragi-font-size",
  keepAwake: "bragi-keep-awake",
  voice: "bragi-voice",
  playbackRate: "bragi-playback-rate",
} as const;

export const FONT_SIZES = ["normal", "large", "largest"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const [themePreference, setThemeSignal] = createSignal<ThemePreference>(
  readChoice(STORAGE_KEYS.theme, THEME_PREFERENCES, "system"),
);
const [locale, setLocaleSignal] = createSignal<Locale>(
  readChoice(STORAGE_KEYS.locale, LOCALES, DEFAULT_LOCALE),
);
const [fontSize, setFontSizeSignal] = createSignal<FontSize>(
  readChoice(STORAGE_KEYS.fontSize, FONT_SIZES, "normal"),
);
const [keepAwake, setKeepAwakeSignal] = createSignal(readString(STORAGE_KEYS.keepAwake) === "true");
const [savedVoice, setSavedVoice] = createSignal(readString(STORAGE_KEYS.voice) || undefined);
const [availableVoices, setAvailableVoices] = createSignal<string[]>([]);
const [playbackRate, setPlaybackRateSignal] = createSignal<PlaybackRate>(
  Number(
    readChoice(STORAGE_KEYS.playbackRate, PLAYBACK_RATES.map(String) as readonly string[], "1"),
  ) as PlaybackRate,
);

export { availableVoices, fontSize, keepAwake, locale, playbackRate, themePreference };

export function setThemePreference(preference: ThemePreference): void {
  setThemeSignal(preference);
  writeString(STORAGE_KEYS.theme, preference);
}

/** Interface text only; text the user or Gemini wrote is never translated. */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  writeString(STORAGE_KEYS.locale, next);
}

export function setFontSize(next: FontSize): void {
  setFontSizeSignal(next);
  writeString(STORAGE_KEYS.fontSize, next);
}

export function setKeepAwake(enabled: boolean): void {
  setKeepAwakeSignal(enabled);
  writeString(STORAGE_KEYS.keepAwake, String(enabled));
}

/**
 * The chosen voice when the server offers it; `undefined` means the server's default voice. A saved
 * choice the server no longer offers is kept, in case it comes back, but not used.
 */
export function voice(): string | undefined {
  const saved = savedVoice();
  return saved && availableVoices().includes(saved) ? saved : undefined;
}

export function setVoice(next: string | undefined): void {
  setSavedVoice(next);
  writeString(STORAGE_KEYS.voice, next ?? "");
}

/** The session decides which voices exist; the first one is the server default. */
export function offerVoices(voices: string[]): void {
  setAvailableVoices(voices);
}

export function setPlaybackRate(next: PlaybackRate): void {
  setPlaybackRateSignal(next);
  writeString(STORAGE_KEYS.playbackRate, String(next));
}

export type PlaybackSettings = { voice?: string; rate: PlaybackRate };

/** Read once at the start of each playback action, so changes never alter audio mid-play. */
export function playbackSettings(): PlaybackSettings {
  return untrack(() => ({ voice: voice(), rate: playbackRate() }));
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
