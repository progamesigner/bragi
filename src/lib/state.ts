import { MAX_DRAFT_SEGMENTS } from "./draft-limits";
import { t } from "./i18n";
import type { OcrResponse } from "./schemas";

export type Segment = OcrResponse["segments"][number] & {
  /** Replacement text sent to speech synthesis while the displayed transcript stays unchanged. */
  spokenText?: string;
};

export function speechText(segment: Segment): string {
  return segment.spokenText ?? segment.text;
}

export function withSpokenText(segment: Segment, spokenText: string | undefined): Segment {
  const { spokenText: _previous, ...transcript } = segment;
  return spokenText === undefined ? transcript : { ...transcript, spokenText };
}

function nextId(): string {
  return `segment-${crypto.randomUUID()}`;
}

export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const current = segments[index];
  const next = segments[index + 1];
  if (!current || !next) return segments;
  const join = (first: string, second: string) =>
    [first.trim(), second.trim()].filter(Boolean).join("\n\n");
  const merged = withSpokenText(
    {
      ...current,
      text: join(current.text, next.text),
      suggestedToneHint: current.suggestedToneHint.trim() || next.suggestedToneHint.trim(),
    },
    current.spokenText === undefined && next.spokenText === undefined
      ? undefined
      : join(speechText(current), speechText(next)),
  );
  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
}

export function splitAtCursor(
  segments: Segment[],
  index: number,
  offset: number,
  id = nextId(),
): Segment[] {
  const segment = segments[index];
  if (!segment) return segments;
  if (segments.length >= MAX_DRAFT_SEGMENTS) throw new Error(t("draft.tooManySegments"));
  const boundaries = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(segment.text),
  ].map(({ index }) => index);
  if (!boundaries.includes(offset) && offset !== segment.text.length)
    throw new Error(t("review.splitNeedsBoundary"));
  const before = segment.text.slice(0, offset).trim();
  const after = segment.text.slice(offset).trim();
  if (!before || !after) throw new Error(t("review.splitNeedsCursor"));
  return [
    ...segments.slice(0, index),
    withSpokenText({ ...segment, text: before }, undefined),
    withSpokenText({ ...segment, id, text: after }, undefined),
    ...segments.slice(index + 1),
  ];
}

export function insertAfter(segments: Segment[], index: number, id = nextId()): Segment[] {
  if (segments.length >= MAX_DRAFT_SEGMENTS) throw new Error(t("draft.tooManySegments"));
  const insertion = Math.min(Math.max(index + 1, 0), segments.length);
  const segment: Segment = { id, text: "", suggestedToneHint: "" };
  return [...segments.slice(0, insertion), segment, ...segments.slice(insertion)];
}

export function removeSegment(segments: Segment[], index: number): Segment[] {
  if (!segments[index]) return segments;
  return [...segments.slice(0, index), ...segments.slice(index + 1)];
}
