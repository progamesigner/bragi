import { describe, expect, it } from "vitest";
import { readChoice, writeString } from "./store/persist";
import { resolveTheme, THEME_PREFERENCES } from "./theme";

function memoryStorage(entries: Record<string, string> = {}) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
  };
}

const blocked = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

describe("theme preference", () => {
  it("follows the OS for system and otherwise uses the explicit choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("defaults to following the system and ignores unknown saved values", () => {
    expect(readChoice("bragi-theme", THEME_PREFERENCES, "system", memoryStorage())).toBe("system");
    expect(
      readChoice(
        "bragi-theme",
        THEME_PREFERENCES,
        "system",
        memoryStorage({ "bragi-theme": "sepia" }),
      ),
    ).toBe("system");
    expect(
      readChoice(
        "bragi-theme",
        THEME_PREFERENCES,
        "system",
        memoryStorage({ "bragi-theme": "light" }),
      ),
    ).toBe("light");
  });

  it("round-trips through storage and survives storage that throws", () => {
    const storage = memoryStorage();
    writeString("bragi-theme", "dark", storage);
    expect(readChoice("bragi-theme", THEME_PREFERENCES, "system", storage)).toBe("dark");
    expect(() => writeString("bragi-theme", "dark", blocked)).not.toThrow();
    expect(readChoice("bragi-theme", THEME_PREFERENCES, "system", blocked)).toBe("system");
  });
});
