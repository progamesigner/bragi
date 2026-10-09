import type { MessageKey } from "./i18n";
import type { PlaybackPhase } from "./playback";

export function playbackAction(phase: PlaybackPhase): MessageKey {
  switch (phase) {
    case "loading":
      return "playback.preparing";
    case "playing":
      return "playback.pause";
    case "paused":
    case "interrupted":
      return "playback.resume";
    case "blocked":
      return "playback.tapToPlay";
    case "waiting":
      return "playback.playNext";
    case "complete":
      return "playback.finish";
    case "error":
      return "playback.retry";
    default:
      return "playback.playThis";
  }
}

/** Interactive controls keep their own keyboard behavior, including button Space clicks. */
export function playbackShortcut(
  event: KeyboardEvent,
  sheetOpen: boolean,
): "toggle" | "previous" | "next" | undefined {
  if (
    sheetOpen ||
    event.repeat ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, a, summary, audio, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="textbox"], [tabindex]:not([tabindex="-1"])',
    )
  )
    return;
  if (event.code === "Space" || event.key === " ") return "toggle";
  if (event.key === "ArrowLeft") return "previous";
  if (event.key === "ArrowRight") return "next";
}
