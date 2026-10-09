import type { BlockReason, PauseReason } from "./audio/controller";
import type { Segment } from "./state";

export type PlaybackSegment = { id: string; version: string };

/** Exact content identity, independent of voice/rate preferences or array position. */
export function playbackSegment(segment: Segment, genreHint?: string): PlaybackSegment {
  return {
    id: segment.id,
    version: JSON.stringify([
      segment.text,
      segment.spokenText ?? null,
      segment.suggestedToneHint,
      genreHint ?? "",
    ]),
  };
}

export type PlaybackPhase =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "blocked"
  | "interrupted"
  | "paused"
  | "waiting"
  | "error"
  | "complete";

export type PlaybackState = {
  index: number;
  phase: PlaybackPhase;
  error?: string;
  reason?: BlockReason | PauseReason;
  position?: number;
  seekable?: boolean;
  played?: PlaybackSegment[];
  activeSegment?: PlaybackSegment;
  reachedEnd?: boolean;
  allPlayed?: boolean;
};

export type PlaybackEvent =
  | { type: "start" }
  | { type: "audio-ready" }
  | { type: "play" }
  | { type: "pause"; reason?: PauseReason }
  | { type: "blocked"; reason: BlockReason }
  | { type: "interrupted"; reason: PauseReason }
  | { type: "seek"; seconds: number }
  | { type: "stream-complete"; seekable: boolean }
  | { type: "navigate"; index: number }
  | { type: "stop" }
  | { type: "ended" }
  | { type: "next" }
  | { type: "retry" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const initialPlaybackState: PlaybackState = { index: 0, phase: "idle" };

export function transitionPlayback(
  state: PlaybackState,
  event: PlaybackEvent,
  segmentCount: number,
  segments?: readonly PlaybackSegment[],
): PlaybackState {
  if (event.type === "reset") return initialPlaybackState;
  if (segmentCount < 1) return initialPlaybackState;

  // IDs and content versions are optional until the existing screens adopt this reducer.
  const played = state.played?.filter(
    (entry) =>
      !segments ||
      segments.some((segment) => segment.id === entry.id && segment.version === entry.version),
  );
  const change = (phase: PlaybackPhase, extra: Partial<PlaybackState> = {}): PlaybackState => {
    const { error: _error, reason: _reason, ...rest } = state;
    return {
      ...rest,
      ...(played ? { played } : {}),
      ...(segments
        ? {
            allPlayed:
              segments.length === segmentCount &&
              segments.every((segment) =>
                played?.some(
                  (entry) => entry.id === segment.id && entry.version === segment.version,
                ),
              ),
          }
        : {}),
      phase,
      ...extra,
    };
  };
  switch (event.type) {
    case "start":
      return state.phase === "idle"
        ? change("loading", segments ? { activeSegment: segments[state.index] } : {})
        : state;
    case "audio-ready":
      return state.phase === "loading" ? change("ready") : state;
    case "stream-complete":
      return { ...state, seekable: event.seekable };
    case "play":
      return ["loading", "ready", "waiting", "paused", "blocked", "interrupted"].includes(
        state.phase,
      )
        ? change("playing")
        : state;
    case "pause":
      if (!["playing", "loading"].includes(state.phase)) return state;
      // Legacy native controls still expect ready; explicit controller reasons opt into paused.
      return event.reason ? change("paused", { reason: event.reason }) : change("ready");
    case "blocked":
      return ["loading", "ready", "playing", "paused", "interrupted"].includes(state.phase)
        ? change("blocked", { reason: event.reason })
        : state;
    case "interrupted":
      return ["playing", "loading"].includes(state.phase)
        ? change("interrupted", { reason: event.reason })
        : state;
    case "seek":
      if (!state.seekable || !Number.isFinite(event.seconds)) return state;
      return state.phase === "waiting" || state.phase === "complete"
        ? change("ready", { position: Math.max(0, event.seconds), reachedEnd: false })
        : { ...state, position: Math.max(0, event.seconds) };
    case "navigate":
      return change("idle", {
        index: Math.max(0, Math.min(event.index, segmentCount - 1)),
        position: 0,
        seekable: false,
        ...(segments ? { reachedEnd: false, activeSegment: undefined } : {}),
      });
    case "stop":
      return change("idle", {
        position: 0,
        seekable: false,
        ...(segments ? { activeSegment: undefined } : {}),
      });
    case "ended": {
      if (state.phase !== "playing") return state;
      const current = state.activeSegment ?? segments?.[state.index];
      if (
        segments &&
        current &&
        !segments.some(
          (segment) => segment.id === current.id && segment.version === current.version,
        )
      )
        return state;
      const completed = current
        ? [...(played ?? []).filter((entry) => entry.id !== current.id), current]
        : played;
      const final = state.index >= segmentCount - 1;
      return change(
        final ? "complete" : "waiting",
        segments
          ? {
              played: completed ?? [],
              reachedEnd: final,
              allPlayed:
                segments.length === segmentCount &&
                segments.every((segment) =>
                  completed?.some(
                    (entry) => entry.id === segment.id && entry.version === segment.version,
                  ),
                ),
            }
          : {},
      );
    }
    case "next":
      return state.phase === "waiting"
        ? change("loading", {
            index: Math.min(state.index + 1, segmentCount - 1),
            ...(segments
              ? {
                  position: 0,
                  seekable: false,
                  activeSegment: segments[Math.min(state.index + 1, segmentCount - 1)],
                }
              : {}),
          })
        : state;
    case "retry":
      return state.phase === "error" ? change("loading") : state;
    case "fail":
      return ["loading", "ready", "playing"].includes(state.phase)
        ? change("error", { error: event.message })
        : state;
  }
}
