import { z } from "zod";

const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemeCount(value: string): number {
  return [...graphemes.segment(value)].length;
}

function hasForbiddenControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint === 127 || (codePoint < 32 && ![9, 10, 13].includes(codePoint)))
    );
  });
}

const optionalHint = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => graphemeCount(value) <= max)
    .optional();

export const ocrRequestSchema = z.object({
  uploadId: z.string().min(1).max(4096),
  receipt: z.unknown().optional(),
  genreHint: optionalHint(80),
});

export const ocrResponseSchema = z.object({
  detectedLanguage: z.string().min(1),
  segments: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().min(1),
      suggestedToneHint: z.string(),
    }),
  ),
});

export const ttsRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .refine((value) => graphemeCount(value) <= 400)
    .refine((value) => encoder.encode(value).byteLength <= 2000)
    .refine((value) => !hasForbiddenControlCharacters(value)),
  toneHint: optionalHint(120),
  genreHint: optionalHint(80),
});

export function isTtsTextTooLong(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (graphemeCount(value.trim()) > 400 || encoder.encode(value.trim()).byteLength > 2000)
  );
}

export type OcrRequest = z.infer<typeof ocrRequestSchema>;
export type OcrResponse = z.infer<typeof ocrResponseSchema>;
export type TtsRequest = z.infer<typeof ttsRequestSchema>;
