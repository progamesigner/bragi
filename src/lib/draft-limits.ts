export const MAX_DRAFT_BYTES = 200_000;
export const MAX_DRAFT_SEGMENTS = 50;
export const MAX_DRAFT_TEXT = 10_000;
export const MAX_DRAFT_TONE = 120;
export const MAX_DRAFT_GENRE = 80;
export const MAX_DRAFT_LANGUAGE = 35;
export const MAX_DRAFT_ID = 64;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemeCount(value: string): number {
  return [...graphemes.segment(value)].length;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
