import { describe, expect, it } from "vitest";
import { initialPlaybackState, type PlaybackState, transitionPlayback } from "./playback";

function transition(state: PlaybackState, type: Parameters<typeof transitionPlayback>[1]) {
  return transitionPlayback(state, type, 3);
}

describe("playback state", () => {
  it("prepares and plays the first segment", () => {
    const loading = transition(initialPlaybackState, { type: "start" });
    const ready = transition(loading, { type: "audio-ready" });

    expect(loading).toEqual({ index: 0, phase: "loading" });
    expect(transition(ready, { type: "play" })).toEqual({ index: 0, phase: "playing" });
  });

  it("waits for an explicit next event between segments", () => {
    const playing: PlaybackState = { index: 0, phase: "playing" };
    const waiting = transition(playing, { type: "ended" });

    expect(waiting).toEqual({ index: 0, phase: "waiting" });
    expect(transition(waiting, { type: "next" })).toEqual({ index: 1, phase: "loading" });
  });

  it("completes after the final segment", () => {
    const final: PlaybackState = { index: 2, phase: "playing" };
    expect(transition(final, { type: "ended" })).toEqual({ index: 2, phase: "complete" });
  });

  it("retries a failed segment without advancing", () => {
    const failed = transition(
      { index: 1, phase: "loading" },
      {
        type: "fail",
        message: "暫時無法產生音訊",
      },
    );

    expect(failed).toEqual({ index: 1, phase: "error", error: "暫時無法產生音訊" });
    expect(transition(failed, { type: "retry" })).toEqual({ index: 1, phase: "loading" });
  });

  it("ignores events that would skip the current phase", () => {
    expect(transition(initialPlaybackState, { type: "next" })).toBe(initialPlaybackState);
    expect(transition(initialPlaybackState, { type: "play" })).toBe(initialPlaybackState);
  });
});
