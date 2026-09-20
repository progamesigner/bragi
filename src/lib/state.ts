import type { OcrResponse } from "./schemas";

export type Segment = OcrResponse["segments"][number];

function nextId(): string {
  return `segment-${crypto.randomUUID()}`;
}

export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const current = segments[index];
  const next = segments[index + 1];
  if (!current || !next) return segments;
  const merged: Segment = {
    ...current,
    text: [current.text.trim(), next.text.trim()].filter(Boolean).join("\n\n"),
    suggestedToneHint: current.suggestedToneHint.trim() || next.suggestedToneHint.trim(),
  };
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
  const before = segment.text.slice(0, offset).trim();
  const after = segment.text.slice(offset).trim();
  if (!before || !after) throw new Error("請先把游標放在段落中間再分割");
  return [
    ...segments.slice(0, index),
    { ...segment, text: before },
    { ...segment, id, text: after },
    ...segments.slice(index + 1),
  ];
}

export function insertAfter(segments: Segment[], index: number, id = nextId()): Segment[] {
  const insertion = Math.min(Math.max(index + 1, 0), segments.length);
  const segment: Segment = { id, text: "", suggestedToneHint: "" };
  return [...segments.slice(0, insertion), segment, ...segments.slice(insertion)];
}

export function removeSegment(segments: Segment[], index: number): Segment[] {
  if (!segments[index]) return segments;
  return [...segments.slice(0, index), ...segments.slice(index + 1)];
}
