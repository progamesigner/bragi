import { z } from "zod";
import {
  graphemeCount,
  MAX_DRAFT_GENRE,
  MAX_DRAFT_ID,
  MAX_DRAFT_LANGUAGE,
  MAX_DRAFT_SEGMENTS,
  MAX_DRAFT_TONE,
} from "./draft-limits";

const encoder = new TextEncoder();

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

export const sessionRequestSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
});

export const uploadSessionRequestSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  sizeBytes: z.number().int().positive(),
});

export const ocrRequestSchema = z.object({
  uploadId: z.string().min(1).max(4096),
  receipt: z.unknown().optional(),
  genreHint: optionalHint(MAX_DRAFT_GENRE),
});

export const ocrResponseSchema = z.object({
  detectedLanguage: z
    .string()
    .min(1)
    .refine((value) => graphemeCount(value) <= MAX_DRAFT_LANGUAGE),
  segments: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .refine((value) => graphemeCount(value) <= MAX_DRAFT_ID),
        text: z
          .string()
          .trim()
          .min(1)
          .refine((value) => graphemeCount(value) <= 400),
        suggestedToneHint: z
          .string()
          .trim()
          .refine((value) => graphemeCount(value) <= MAX_DRAFT_TONE),
      }),
    )
    .min(1)
    .max(MAX_DRAFT_SEGMENTS),
});

export const ttsRequestSchema = z.object({
  voice: z.string().trim().min(1).max(80).optional(),
  text: z
    .string()
    .trim()
    .min(1)
    .refine((value) => graphemeCount(value) <= 400)
    .refine((value) => encoder.encode(value).byteLength <= 2000)
    .refine((value) => !hasForbiddenControlCharacters(value)),
  toneHint: optionalHint(MAX_DRAFT_TONE),
  genreHint: optionalHint(MAX_DRAFT_GENRE),
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
