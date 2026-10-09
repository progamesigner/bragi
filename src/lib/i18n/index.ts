import { locale } from "../store/preferences";
import type { Locale } from "./locales";
import de from "./messages/de";
import en from "./messages/en";
import es from "./messages/es";
import ja from "./messages/ja";
import ko from "./messages/ko";
import zhHans from "./messages/zh-Hans";
import zhHant, { type MessageKey, type Messages } from "./messages/zh-Hant";

export { DEFAULT_LOCALE, LOCALE_NAMES, LOCALES, type Locale } from "./locales";
export type { MessageKey, Messages };

const dictionaries: Record<Locale, Partial<Messages>> = {
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
  ja,
  ko,
  en,
  de,
  es,
};

export type MessageParams = Record<string, string | number>;

export function format(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Looks a key up in one locale, falling back to Traditional Chinese for anything untranslated. */
export function translate(target: Locale, key: MessageKey, params?: MessageParams): string {
  return format(dictionaries[target][key] ?? zhHant[key], params);
}

/** Translates into the current interface language; reactive when read inside JSX or effects. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale(), key, params);
}
