import type { Segment } from "./state";

/** IDs survive reordering. Missing targets fall forward, then back to the last survivor. */
export function reviewTarget(segments: readonly Segment[], id?: string, formerIndex = 0) {
  return (
    segments.find((segment) => segment.id === id)?.id ??
    segments[Math.min(Math.max(0, formerIndex), segments.length - 1)]?.id
  );
}

export function reviewShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">,
  path: string,
  sheetOpen: boolean,
  composing: boolean,
) {
  if (
    path !== "/review" ||
    sheetOpen ||
    composing ||
    event.isComposing ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
}
