import { describe, expect, it } from "vitest";
import { type Draft, draftFileName, parseDraft, serializeDraft } from "./draft";

const draft: Draft = {
  detectedLanguage: "繁體中文",
  genreHint: "奇幻",
  segments: [
    { id: "one", text: "故事開始。", suggestedToneHint: "平靜", spokenText: "故事，開始。" },
    { id: "two", text: "門打開了。👨‍👩‍👧", suggestedToneHint: "" },
  ],
};

function envelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ ...JSON.parse(serializeDraft(draft)), ...overrides });
}

describe("draft files", () => {
  it("round-trips the editable draft", () => {
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("exports only versioned transcript fields", () => {
    const exported = JSON.parse(
      serializeDraft(
        { ...draft, segments: [{ ...draft.segments[1], audio: "blob:secret" } as never] },
        new Date("2026-09-26T08:00:00Z"),
      ),
    );
    expect(exported).toEqual({
      format: "bragi-draft",
      version: 1,
      exportedAt: "2026-09-26T08:00:00.000Z",
      detectedLanguage: "繁體中文",
      genreHint: "奇幻",
      segments: [{ id: "two", text: "門打開了。👨‍👩‍👧", suggestedToneHint: "" }],
    });
  });

  it("accepts an empty draft and long text that still needs splitting", () => {
    expect(parseDraft(serializeDraft({ ...draft, segments: [] })).segments).toEqual([]);
    const long = "故事開始。".repeat(150);
    const parsed = parseDraft(
      serializeDraft({ ...draft, segments: [{ id: "long", text: long, suggestedToneHint: "" }] }),
    );
    expect(parsed.segments[0]?.text).toBe(long);
  });

  it("rejects unknown versions, malformed JSON and foreign files", () => {
    expect(() => parseDraft(envelope({ version: 2 }))).toThrow("版本");
    expect(() => parseDraft("{")).toThrow("JSON");
    expect(() => parseDraft(JSON.stringify({ segments: [] }))).toThrow("格式");
  });

  it("rejects duplicate IDs and fields outside the schema", () => {
    const duplicate = [draft.segments[0], { ...draft.segments[1], id: "one" }];
    expect(() => parseDraft(envelope({ segments: duplicate }))).toThrow("格式");
    expect(() => parseDraft(envelope({ session: "jwt" }))).toThrow("格式");
    expect(() =>
      parseDraft(envelope({ segments: [{ ...draft.segments[1], audio: "data:audio/wav" }] })),
    ).toThrow("格式");
  });

  it("rejects oversized drafts and too many segments", () => {
    expect(() => parseDraft(" ".repeat(200_001))).toThrow("200 KB");
    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `s${i}`,
      text: "段落",
      suggestedToneHint: "",
    }));
    expect(() => parseDraft(envelope({ segments: many }))).toThrow("格式");
  });

  it("names exports by local time", () => {
    expect(draftFileName(new Date(2026, 8, 26, 7, 5))).toBe("bragi-draft-20260926-0705.json");
  });
});
