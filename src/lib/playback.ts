export type PlaybackPhase =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "waiting"
  | "error"
  | "complete";

export type PlaybackState = {
  index: number;
  phase: PlaybackPhase;
  error?: string;
};

export type PlaybackEvent =
  | { type: "start" }
  | { type: "audio-ready" }
  | { type: "play" }
  | { type: "pause" }
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
): PlaybackState {
  if (event.type === "reset") return initialPlaybackState;
  if (segmentCount < 1) return initialPlaybackState;

  switch (event.type) {
    case "start":
      return state.phase === "idle" ? { index: 0, phase: "loading" } : state;
    case "audio-ready":
      return state.phase === "loading" ? { index: state.index, phase: "ready" } : state;
    case "play":
      return state.phase === "ready" || state.phase === "waiting"
        ? { index: state.index, phase: "playing" }
        : state;
    case "pause":
      return state.phase === "playing" ? { index: state.index, phase: "ready" } : state;
    case "ended":
      if (state.phase !== "playing") return state;
      return state.index >= segmentCount - 1
        ? { index: state.index, phase: "complete" }
        : { index: state.index, phase: "waiting" };
    case "next":
      return state.phase === "waiting"
        ? { index: Math.min(state.index + 1, segmentCount - 1), phase: "loading" }
        : state;
    case "retry":
      return state.phase === "error" ? { index: state.index, phase: "loading" } : state;
    case "fail":
      return ["loading", "ready", "playing"].includes(state.phase)
        ? { index: state.index, phase: "error", error: event.message }
        : state;
  }
}
