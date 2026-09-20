import { describe, expect, it } from "vitest";
import { isTtsTextTooLong, ocrRequestSchema, ttsRequestSchema } from "./schemas";

describe("API schemas", () => {
  it("normalizes valid OCR and TTS requests", () => {
    expect(
      ocrRequestSchema.parse({ uploadId: "upload", receipt: { file: { name: "files/1" } } }),
    ).toEqual({ uploadId: "upload", receipt: { file: { name: "files/1" } } });
    expect(ttsRequestSchema.parse({ text: "  冒險開始  ", toneHint: "  神祕  " })).toEqual({
      text: "冒險開始",
      toneHint: "神祕",
    });
  });

  it("rejects malformed requests and control characters", () => {
    expect(ocrRequestSchema.safeParse({ uploadId: "" }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: "hello\u0000world" }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("counts Unicode graphemes and UTF-8 bytes for product limits", () => {
    expect(ttsRequestSchema.safeParse({ text: "👨‍👩‍👧‍👦".repeat(400) }).success).toBe(false);
    expect(isTtsTextTooLong("a".repeat(401))).toBe(true);
    expect(isTtsTextTooLong("界".repeat(400))).toBe(false);
  });
});
