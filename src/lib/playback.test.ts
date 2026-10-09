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

  it("surfaces a stream interrupted during playback", () => {
    expect(
      transition({ index: 1, phase: "playing" }, { type: "fail", message: "串流中斷" }),
    ).toEqual({ index: 1, phase: "error", error: "串流中斷" });
  });

  it("ignores events that would skip the current phase", () => {
    expect(transition(initialPlaybackState, { type: "next" })).toBe(initialPlaybackState);
    expect(transition(initialPlaybackState, { type: "play" })).toBe(initialPlaybackState);
  });
});

const segments = [
  { id: "a", version: "one" },
  { id: "b", version: "one" },
  { id: "c", version: "one" },
];

it("keeps blocking, interruption and user pause out of synthesis retry", () => {
  for (const event of [
    { type: "blocked", reason: "resume-timeout" },
    { type: "interrupted", reason: "visibility" },
    { type: "pause", reason: "user" },
  ] as const) {
    const suspended = transition({ index: 1, phase: "playing" }, event);
    expect(suspended.reason).toBe(event.reason);
    expect(transition(suspended, { type: "retry" })).toBe(suspended);
    expect(transition(suspended, { type: "fail", message: "bad" })).toBe(suspended);
    expect(transition(suspended, { type: "play" })).toMatchObject({ index: 1, phase: "playing" });
  }
});

it("treats stream EOF as seek readiness and preserves paused seek", () => {
  const paused: PlaybackState = { index: 1, phase: "paused", reason: "user" };
  const ready = transition(paused, { type: "stream-complete", seekable: true });
  expect(ready.phase).toBe("paused");
  expect(transition(ready, { type: "audio-ready" })).toBe(ready);
  expect(transition(ready, { type: "ended" })).toBe(ready);
  expect(transition(ready, { type: "seek", seconds: 2 })).toMatchObject({
    phase: "paused",
    reason: "user",
    index: 1,
    position: 2,
  });
  expect(transition(paused, { type: "seek", seconds: 2 })).toBe(paused);
});

it("distinguishes reaching the last segment from playing every content version", () => {
  let state: PlaybackState = { index: 0, phase: "playing" };
  state = transitionPlayback(state, { type: "ended" }, 3, segments);
  state = transitionPlayback(state, { type: "navigate", index: 2 }, 3, segments);
  state = transitionPlayback(state, { type: "start" }, 3, segments);
  state = transitionPlayback(state, { type: "play" }, 3, segments);
  state = transitionPlayback(state, { type: "ended" }, 3, segments);
  expect(state).toMatchObject({
    phase: "complete",
    reachedEnd: true,
    allPlayed: false,
    played: [segments[0], segments[2]],
  });
  state = transitionPlayback(state, { type: "navigate", index: 1 }, 3, segments);
  state = transitionPlayback(state, { type: "start" }, 3, segments);
  state = transitionPlayback(state, { type: "play" }, 3, segments);
  state = transitionPlayback(state, { type: "ended" }, 3, segments);
  expect(state.allPlayed).toBe(true);
  const changed = [
    { id: "a", version: "two" },
    { id: "b", version: "one" },
    { id: "c", version: "one" },
  ];
  state = transitionPlayback(state, { type: "next" }, 3, changed);
  state = transitionPlayback(state, { type: "play" }, 3, changed);
  state = transitionPlayback(state, { type: "ended" }, 3, changed);
  expect(state.allPlayed).toBe(false);
  expect(state.played?.some((entry) => entry.id === "a")).toBe(false);
});

it("returns cancellation to idle at the same segment and replays a completed asset via seek", () => {
  expect(transition({ index: 1, phase: "loading" }, { type: "stop" })).toMatchObject({
    index: 1,
    phase: "idle",
  });
  expect(
    transition({ index: 2, phase: "complete", seekable: true }, { type: "seek", seconds: 0 }),
  ).toMatchObject({ index: 2, phase: "ready", position: 0 });
});

it("does not mark a newly edited version as played by an old active segment", () => {
  let state = transitionPlayback(initialPlaybackState, { type: "start" }, 3, segments);
  state = transitionPlayback(state, { type: "play" }, 3, segments);
  const edited = [{ id: "a", version: "changed" }, ...segments.slice(1)];
  expect(transitionPlayback(state, { type: "ended" }, 3, edited)).toBe(state);
});
