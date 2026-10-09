export const LOCALES = ["zh-Hant", "zh-Hans", "ja", "ko", "en", "de", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-Hant";
export const LOCALE_STORAGE_KEY = "bragi-locale";

/** Each language is named in itself so people can find their own. */
export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  ja: "日本語",
  ko: "한국어",
  en: "English",
  de: "Deutsch",
  es: "Español",
};

/** Use a stored choice first; otherwise match the browser language without translating content. */
export function browserLocale(language: string | undefined): Locale {
  const tag = language?.toLowerCase() ?? "";
  if (tag.startsWith("zh")) return /hant|tw|hk|mo/.test(tag) ? "zh-Hant" : "zh-Hans";
  return LOCALES.find((value) => tag === value || tag.startsWith(`${value}-`)) ?? DEFAULT_LOCALE;
}
