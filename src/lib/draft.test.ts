import { describe, expect, it } from "vitest";
import { type Draft, draftFileName, parseDraft, serializeDraft } from "./draft";
import { MAX_DRAFT_BYTES, MAX_DRAFT_SEGMENTS, MAX_DRAFT_TEXT, utf8Bytes } from "./draft-limits";
import { ocrResponseSchema } from "./schemas";
import { insertAfter, splitAtCursor } from "./state";

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

  it("shares the 50-segment boundary across editing, OCR and backup", () => {
    const segments = Array.from({ length: MAX_DRAFT_SEGMENTS }, (_, i) => ({
      id: `s${i}`,
      text: "故事開始。",
      suggestedToneHint: "",
    }));
    const boundary = { ...draft, segments };
    expect(parseDraft(serializeDraft(boundary))).toEqual(boundary);
    expect(ocrResponseSchema.safeParse(boundary).success).toBe(true);
    expect(() => insertAfter(segments, 0)).toThrow("50");
    expect(() => splitAtCursor(segments, 0, 2)).toThrow("50");
    const overflow = {
      ...boundary,
      segments: [...segments, { id: "extra", text: "故事", suggestedToneHint: "" }],
    };
    expect(() => serializeDraft(overflow)).toThrow("限制");
    expect(() => parseDraft(envelope(overflow))).toThrow("格式");
    expect(ocrResponseSchema.safeParse(overflow).success).toBe(false);
  });

  it("round-trips exactly 200,000 UTF-8 bytes and rejects the next byte", () => {
    const boundary: Draft = {
      detectedLanguage: "zh",
      segments: Array.from({ length: 20 }, (_, i) => ({
        id: `s${i}`,
        text: i < 19 ? "a".repeat(MAX_DRAFT_TEXT) : "",
        suggestedToneHint: "",
      })),
    };
    const remaining = MAX_DRAFT_BYTES - utf8Bytes(serializeDraft(boundary));
    const last = boundary.segments[19];
    if (!last) throw new Error("Missing boundary segment");
    last.text = "a".repeat(remaining);
    const source = serializeDraft(boundary);
    expect(utf8Bytes(source)).toBe(MAX_DRAFT_BYTES);
    expect(parseDraft(source)).toEqual({ ...boundary, genreHint: undefined });
    expect(() => parseDraft(`${source} `)).toThrow("200 KB");
    last.text += "a";
    expect(() => serializeDraft(boundary)).toThrow("200 KB");
    // A compact file below the raw size limit may still exceed the canonical export budget.
    const compact = JSON.stringify({ ...JSON.parse(source), segments: boundary.segments });
    expect(utf8Bytes(compact)).toBeLessThan(MAX_DRAFT_BYTES);
    expect(() => parseDraft(compact)).toThrow("200 KB");
  });

  it("counts Unicode graphemes consistently while measuring the actual UTF-8 file", () => {
    const unicode: Draft = {
      detectedLanguage: "😀".repeat(35),
      genreHint: "😀".repeat(80),
      segments: [
        {
          id: "😀".repeat(64),
          text: "😀".repeat(MAX_DRAFT_TEXT),
          suggestedToneHint: "👨‍👩‍👧".repeat(120),
          spokenText: "e\u0301".repeat(MAX_DRAFT_TEXT),
        },
      ],
    };
    expect(parseDraft(serializeDraft(unicode))).toEqual(unicode);
    expect(() => serializeDraft({ ...unicode, genreHint: `${unicode.genreHint}a` })).toThrow(
      "限制",
    );
    expect(() =>
      serializeDraft({
        ...unicode,
        segments: [{ id: "one", suggestedToneHint: "", text: "😀".repeat(MAX_DRAFT_TEXT + 1) }],
      }),
    ).toThrow("限制");
    const large = {
      ...draft,
      segments: Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        text: "😀".repeat(9000),
        suggestedToneHint: "",
      })),
    };
    expect(() => serializeDraft(large)).toThrow("200 KB");
  });
});
