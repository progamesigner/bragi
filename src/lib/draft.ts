import { z } from "zod";
import type { Segment } from "./state";

export const DRAFT_FORMAT = "bragi-draft";
export const DRAFT_VERSION = 1;
export const MAX_DRAFT_BYTES = 200_000;

const encoder = new TextEncoder();

// Drafts may hold text that is still too long to speak; playback validates it later.
const draftSegmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().max(10_000),
    suggestedToneHint: z.string().max(120),
    spokenText: z.string().max(10_000).optional(),
  })
  .strict();

const draftSchema = z
  .object({
    format: z.literal(DRAFT_FORMAT),
    version: z.literal(DRAFT_VERSION),
    exportedAt: z.iso.datetime(),
    detectedLanguage: z.string().trim().min(1).max(35),
    genreHint: z.string().trim().max(80).optional(),
    segments: z
      .array(draftSegmentSchema)
      .max(50)
      .refine((segments) => new Set(segments.map(({ id }) => id)).size === segments.length),
  })
  .strict();

export type Draft = {
  detectedLanguage: string;
  genreHint?: string;
  segments: Segment[];
};

export function serializeDraft(draft: Draft, now = new Date()): string {
  return `${JSON.stringify(
    {
      format: DRAFT_FORMAT,
      version: DRAFT_VERSION,
      exportedAt: now.toISOString(),
      detectedLanguage: draft.detectedLanguage,
      genreHint: draft.genreHint || undefined,
      segments: draft.segments.map(({ id, text, suggestedToneHint, spokenText }) => ({
        id,
        text,
        suggestedToneHint,
        spokenText,
      })),
    },
    null,
    2,
  )}\n`;
}

export function parseDraft(source: string): Draft {
  if (encoder.encode(source).byteLength > MAX_DRAFT_BYTES)
    throw new Error("草稿檔案超過 200 KB，無法匯入");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("草稿檔案不是有效的 JSON");
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    value.format === DRAFT_FORMAT &&
    "version" in value &&
    value.version !== DRAFT_VERSION
  )
    throw new Error("不支援這個版本的 Bragi 草稿");
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) throw new Error("草稿檔案格式不正確，或含有不允許的欄位");
  const { detectedLanguage, genreHint, segments } = parsed.data;
  return { detectedLanguage, genreHint: genreHint || undefined, segments };
}

export function draftFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `bragi-draft-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
