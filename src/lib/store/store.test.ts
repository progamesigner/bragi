import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import type { Segment } from "../state";
import {
  fontSize,
  PREFERENCE_APPLIES,
  playbackRate,
  playbackSettings,
  setFontSize,
  setPlaybackRate,
} from "./preferences";
import { createWorkspace } from "./workspace";

const draft = {
  detectedLanguage: "繁體中文",
  genreHint: "奇幻",
  segments: [
    { id: "one", text: "故事開始。", suggestedToneHint: "平靜" },
    { id: "two", text: "門打開了。", suggestedToneHint: "期待" },
  ] satisfies Segment[],
};

describe("workspace store", () => {
  it("loads a draft as saved, with no history and the first segment current", () => {
    const workspace = createWorkspace();
    workspace.load(draft);
    expect(workspace.hasDraft()).toBe(true);
    expect([...workspace.segments]).toEqual(draft.segments);
    expect(workspace.dirty()).toBe(false);
    expect(workspace.canUndo()).toBe(false);
    expect(workspace.currentSegment()).toBe(0);
  });

  it("tracks edits against the saved snapshot through undo and redo", () => {
    const workspace = createWorkspace();
    workspace.load(draft);
    const edited = draft.segments.map((segment, index) =>
      index === 0 ? { ...segment, text: "改過的故事。" } : segment,
    );
    workspace.edit(edited);
    expect(workspace.dirty()).toBe(true);
    expect(workspace.canUndo()).toBe(true);
    workspace.undo();
    expect(workspace.segments[0]?.text).toBe("故事開始。");
    expect(workspace.dirty()).toBe(false);
    workspace.redo();
    expect(workspace.dirty()).toBe(true);
    workspace.markSaved();
    expect(workspace.dirty()).toBe(false);
    workspace.setGenreHint("懸疑");
    expect(workspace.dirty()).toBe(true);
  });

  it("keeps the current segment inside the draft", () => {
    const workspace = createWorkspace();
    workspace.load(draft);
    workspace.setCurrentSegment(5);
    expect(workspace.currentSegment()).toBe(1);
    workspace.edit(draft.segments.slice(0, 1));
    expect(workspace.currentSegment()).toBe(0);
    workspace.setCurrentSegment(-3);
    expect(workspace.currentSegment()).toBe(0);
  });

  it("outlives the screen that used it", () => {
    const workspace = createWorkspace();
    createRoot((dispose) => {
      workspace.load(draft);
      workspace.edit([...draft.segments, { id: "three", text: "", suggestedToneHint: "" }]);
      workspace.setCurrentSegment(2);
      dispose();
    });
    expect(workspace.segments).toHaveLength(3);
    expect(workspace.canUndo()).toBe(true);
    expect(workspace.currentSegment()).toBe(2);
  });

  it("discarding a draft keeps the picture and clearing drops everything", () => {
    const workspace = createWorkspace();
    const file = new File(["x"], "card.jpg", { type: "image/jpeg" });
    workspace.setImage({ file, transformed: false });
    workspace.load(draft);
    workspace.discardDraft();
    expect(workspace.hasDraft()).toBe(false);
    expect(workspace.image()?.file).toBe(file);
    expect(workspace.genreHint()).toBe("奇幻");
    workspace.clear();
    expect(workspace.image()).toBeUndefined();
    expect(workspace.genreHint()).toBe("");
    expect(workspace.dirty()).toBe(false);
  });
});

describe("preference rules", () => {
  it("documents when each preference applies", () => {
    expect(PREFERENCE_APPLIES).toMatchObject({
      fontSize: "immediately",
      theme: "immediately",
      locale: "immediately",
      voice: "next-playback",
      playbackRate: "next-playback",
    });
  });

  it("hands playback a snapshot that later changes do not alter", () => {
    setPlaybackRate(1);
    const started = playbackSettings();
    setPlaybackRate(1.5);
    expect(started.rate).toBe(1);
    expect(playbackSettings().rate).toBe(1.5);
    expect(playbackRate()).toBe(1.5);
    setPlaybackRate(1);
  });

  it("applies font size immediately", () => {
    setFontSize("largest");
    expect(fontSize()).toBe("largest");
    setFontSize("normal");
  });
});
