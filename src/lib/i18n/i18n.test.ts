import { describe, expect, it } from "vitest";
import { format, LOCALE_NAMES, LOCALES, t, translate } from ".";
import en from "./messages/en";
import zhHant from "./messages/zh-Hant";

describe("interface strings", () => {
  it("defaults to Traditional Chinese", () => {
    expect(t("review.undo")).toBe("復原");
  });

  it("falls back to Traditional Chinese for every key a locale has not translated", () => {
    for (const locale of LOCALES)
      for (const key of Object.keys(zhHant) as (keyof typeof zhHant)[])
        expect(translate(locale, key)).toBeTruthy();
    expect(en["review.undo"]).toBeUndefined();
    expect(translate("en", "review.undo")).toBe("復原");
  });

  it("fills named placeholders and leaves unknown ones visible", () => {
    expect(translate("ja", "playback.heading", { n: 2, total: 5 })).toBe("第 2 段，共 5 段");
    expect(format("{a} / {b}", { a: 1 })).toBe("1 / {b}");
  });

  it("names every supported language in that language", () => {
    expect(Object.keys(LOCALE_NAMES)).toEqual([...LOCALES]);
    expect(LOCALE_NAMES.ja).toBe("日本語");
  });
});
