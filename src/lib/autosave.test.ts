import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY, AUTOSAVE_KEY, DraftAutosave } from "./autosave";
import { type Draft, parseDraft, serializeDraft } from "./draft";

const draft: Draft = {
  detectedLanguage: "zh",
  genreHint: "奇幻",
  segments: [{ id: "one", text: "故事", suggestedToneHint: "平靜", spokenText: "故事。" }],
};
const storage = () => {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
};
afterEach(() => vi.useRealTimers());

describe("local text autosave", () => {
  it("debounces edits and snapshots only the versioned text payload", () => {
    vi.useFakeTimers();
    const local = storage();
    const autosave = new DraftAutosave(() => local);
    autosave.schedule(draft);
    vi.advanceTimersByTime(AUTOSAVE_DELAY - 1);
    expect(local.setItem).not.toHaveBeenCalled();
    const segment = {
      id: "one",
      text: "新稿",
      suggestedToneHint: "平靜",
      spokenText: "故事。",
      audio: "secret",
    };
    const next = { ...draft, segments: [segment] };
    autosave.schedule(next);
    segment.text = "尚未排程";
    vi.advanceTimersByTime(AUTOSAVE_DELAY);
    expect(local.setItem).toHaveBeenCalledTimes(1);
    const source = local.getItem(AUTOSAVE_KEY) ?? "";
    expect(source).not.toContain("secret");
    expect(parseDraft(source).segments[0]?.text).toBe("新稿");
    expect(autosave.load()?.segments[0]?.spokenText).toBe("故事。");
  });

  it("clears pending writes and replaces old content immediately on commit", () => {
    vi.useFakeTimers();
    const local = storage();
    const autosave = new DraftAutosave(() => local);
    autosave.schedule(draft);
    autosave.clear();
    vi.runAllTimers();
    expect(local.getItem(AUTOSAVE_KEY)).toBeNull();
    autosave.schedule({ ...draft, genreHint: "stale" });
    autosave.save(draft);
    vi.runAllTimers();
    expect(autosave.load()).toEqual(draft);
    autosave.clear();
    expect(autosave.load()).toBeUndefined();
  });

  it("discards malformed, foreign and oversized saved data", () => {
    const local = storage();
    const autosave = new DraftAutosave(() => local);
    for (const source of [
      "{",
      JSON.stringify({ format: "other" }),
      " ".repeat(200_001),
      JSON.stringify({ ...JSON.parse(serializeDraft(draft)), session: "forbidden" }),
    ]) {
      local.setItem(AUTOSAVE_KEY, source);
      expect(autosave.load()).toBeUndefined();
      expect(local.getItem(AUTOSAVE_KEY)).toBeNull();
    }
  });

  it("silently tolerates unavailable storage and quota failures", () => {
    vi.useFakeTimers();
    const autosave = new DraftAutosave(() => {
      throw new Error("SecurityError");
    });
    expect(() => {
      autosave.load();
      autosave.save(draft);
      autosave.schedule(draft);
      vi.runAllTimers();
      autosave.clear();
    }).not.toThrow();
    const local = storage();
    local.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const quota = new DraftAutosave(() => local);
    expect(() => {
      quota.save(draft);
      quota.schedule(draft);
      vi.runAllTimers();
    }).not.toThrow();
  });
});
