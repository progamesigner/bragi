import { describe, expect, it } from "vitest";
import { format, LOCALE_NAMES, LOCALES, languageName, t, translate } from ".";
import { browserLocale } from "./locales";
import de from "./messages/de";
import en from "./messages/en";
import es from "./messages/es";
import ja from "./messages/ja";
import ko from "./messages/ko";
import zhHans from "./messages/zh-Hans";
import zhHant from "./messages/zh-Hant";

describe("interface strings", () => {
  it("defaults to Traditional Chinese", () => {
    expect(t("review.undo")).toBe("復原");
  });

  it("names OCR language tags and preserves readable or unknown values", () => {
    expect(languageName("ko")).toBe("韓文");
    expect(languageName("繁體中文")).toBe("繁體中文");
    expect(languageName("x-unknown")).toBe("x-unknown");
    expect(languageName("zz")).toBe("zz");
  });

  it("provides every source key and preserves placeholders in every dictionary", () => {
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const dictionary of [zhHans, ja, ko, en, de, es]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(zhHant).sort());
      for (const key of Object.keys(zhHant) as (keyof typeof zhHant)[]) {
        expect(dictionary[key].trim(), key).not.toBe("");
        expect(placeholders(dictionary[key]), key).toEqual(placeholders(zhHant[key]));
      }
    }
    expect(translate("en", "review.undo")).toBe("Undo");
  });

  it("fills named placeholders and leaves unknown ones visible", () => {
    expect(translate("ja", "playback.heading", { n: 2, total: 5 })).toBe("5段落中の第2段落");
    expect(format("{a} / {b}", { a: 1 })).toBe("1 / {b}");
  });

  it("names every supported language in that language", () => {
    expect(Object.keys(LOCALE_NAMES)).toEqual([...LOCALES]);
    expect(LOCALE_NAMES.ja).toBe("日本語");
  });

  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["zh-CN", "zh-Hans"],
    ["zh-Hans", "zh-Hans"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["en-US", "en"],
    ["de-DE", "de"],
    ["es-MX", "es"],
    ["fr-FR", "zh-Hant"],
    [undefined, "zh-Hant"],
  ])("matches browser language %s to %s", (language, expected) => {
    expect(browserLocale(language)).toBe(expected);
  });
});
