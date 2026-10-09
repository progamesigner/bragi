import { z } from "zod";
import {
  graphemeCount,
  MAX_DRAFT_BYTES,
  MAX_DRAFT_GENRE,
  MAX_DRAFT_ID,
  MAX_DRAFT_LANGUAGE,
  MAX_DRAFT_SEGMENTS,
  MAX_DRAFT_TEXT,
  MAX_DRAFT_TONE,
  utf8Bytes,
} from "./draft-limits";
import type { Segment } from "./state";

export { MAX_DRAFT_BYTES } from "./draft-limits";

export const DRAFT_FORMAT = "bragi-draft";
export const DRAFT_VERSION = 1;
const boundedText = (max: number) => z.string().refine((value) => graphemeCount(value) <= max);

// Drafts may hold text that is still too long to speak; playback validates it later.
const draftSegmentSchema = z
  .object({
    id: boundedText(MAX_DRAFT_ID).min(1),
    text: boundedText(MAX_DRAFT_TEXT),
    suggestedToneHint: boundedText(MAX_DRAFT_TONE),
    spokenText: boundedText(MAX_DRAFT_TEXT).optional(),
  })
  .strict();

const draftSchema = z
  .object({
    format: z.literal(DRAFT_FORMAT),
    version: z.literal(DRAFT_VERSION),
    exportedAt: z.iso.datetime(),
    detectedLanguage: boundedText(MAX_DRAFT_LANGUAGE).refine((value) => !!value.trim()),
    genreHint: boundedText(MAX_DRAFT_GENRE).optional(),
    segments: z
      .array(draftSegmentSchema)
      .max(MAX_DRAFT_SEGMENTS)
      .refine((segments) => new Set(segments.map(({ id }) => id)).size === segments.length),
  })
  .strict();

export type Draft = {
  detectedLanguage: string;
  genreHint?: string;
  segments: Segment[];
};

export function serializeDraft(draft: Draft, now = new Date()): string {
  const payload = {
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
  };
  if (!draftSchema.safeParse(payload).success) throw new Error("草稿超過段數或欄位限制，無法儲存");
  const source = `${JSON.stringify(payload, null, 2)}\n`;
  if (utf8Bytes(source) > MAX_DRAFT_BYTES)
    throw new Error("草稿檔案超過 200 KB，請縮短文字或刪除段落");
  return source;
}

export function parseDraft(source: string): Draft {
  if (utf8Bytes(source) > MAX_DRAFT_BYTES) throw new Error("草稿檔案超過 200 KB，無法匯入");
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
  const draft = { detectedLanguage, genreHint: genreHint || undefined, segments };
  // Compact imports must also fit the canonical export, so every accepted draft is recoverable.
  serializeDraft(draft);
  return draft;
}

export function draftFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `bragi-draft-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
