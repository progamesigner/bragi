import { expect, it } from "vitest";
import { audioTime } from "./audio/session";
import { translate } from "./i18n";
import type { PlaybackPhase } from "./playback";
import { playbackSegment } from "./playback";
import { playbackAction, playbackShortcut } from "./playback-ui";
import { createWorkspace } from "./store/workspace";

it.each<[PlaybackPhase, string]>([
  ["idle", "播放此段"],
  ["loading", "正在準備音訊"],
  ["playing", "暫停"],
  ["paused", "繼續播放"],
  ["interrupted", "繼續播放"],
  ["waiting", "播放下一段"],
  ["complete", "完成朗讀"],
  ["error", "重試本段"],
  ["blocked", "點一下播放"],
])("labels the %s primary action", (phase, expected) => {
  expect(translate("zh-Hant", playbackAction(phase))).toBe(expected);
});

it("formats finite elapsed audio time without a fake total", () => {
  expect(audioTime(3.9)).toBe("00:03");
  expect(audioTime(67)).toBe("01:07");
  expect(audioTime(Number.NaN)).toBe("00:00");
});

it("keeps valid played versions across edits and resets a new reading session", () => {
  const store = createWorkspace();
  const a = { id: "one", text: "First", suggestedToneHint: "" };
  const b = { id: "two", text: "Last", suggestedToneHint: "" };
  store.load({ detectedLanguage: "en", segments: [a, b] });
  store.recordPlayback(playbackSegment(a), 7);
  store.recordPlayback(playbackSegment(b), 3);
  store.recordPlayback(playbackSegment(a), 8);
  expect(store.played().length).toBe(2);
  expect(store.played().reduce((sum, entry) => sum + entry.seconds, 0)).toBe(11);
  store.edit([b, a]);
  expect(store.played().length).toBe(2);
  store.edit([{ ...a, spokenText: "New" }, b]);
  expect(store.played().map((entry) => entry.id)).toEqual(["two"]);
  store.undo();
  expect(store.played().length).toBe(2);
  store.setGenreHint("new genre");
  expect(store.played()).toEqual([]);
  store.setGenreHint("");
  store.setCurrentSegment(1);
  store.resetPlayback();
  expect(store.played()).toEqual([]);
  expect(store.currentSegment()).toBe(0);
  store.recordPlayback(playbackSegment(b), 3);
  store.load({ detectedLanguage: "en", segments: [a, b] });
  expect(store.played()).toEqual([]);
});

it("ignores repeat, modifiers and sheets before looking at a keyboard target", () => {
  for (const property of [
    "repeat",
    "defaultPrevented",
    "ctrlKey",
    "altKey",
    "metaKey",
    "shiftKey",
  ]) {
    expect(
      playbackShortcut({ code: "Space", [property]: true } as unknown as KeyboardEvent, false),
    ).toBeUndefined();
  }
  expect(playbackShortcut({ code: "Space" } as KeyboardEvent, true)).toBeUndefined();
});
