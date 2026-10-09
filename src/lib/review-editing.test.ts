import { expect, it } from "vitest";
import { reviewShortcut, reviewTarget } from "./review-editing";
import { mergeWithNext, removeSegment, splitAtCursor } from "./state";

const segments = ["one", "two", "three"].map((id) => ({ id, text: id, suggestedToneHint: "" }));
it("keeps stable identities and falls forward then backward after removal", () => {
  expect(reviewTarget([...segments].reverse(), "two")).toBe("two");
  expect(reviewTarget(mergeWithNext(segments, 0), "one")).toBe("one");
  expect(reviewTarget(mergeWithNext(segments, 0), "two", 0)).toBe("one");
  expect(reviewTarget(removeSegment(segments, 1), "two", 1)).toBe("three");
  expect(reviewTarget(removeSegment(segments, 2), "three", 2)).toBe("two");
  expect(reviewTarget([], "one")).toBeUndefined();
  expect(reviewTarget(splitAtCursor(segments, 0, 1, "new"), "one")).toBe("one");
});
it("maps undo and redo only in review outside sheets and composition", () => {
  const event = {
    key: "z",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
  };
  expect(reviewShortcut(event, "/review", false, false)).toBe("undo");
  expect(reviewShortcut({ ...event, ctrlKey: false, metaKey: true }, "/review", false, false)).toBe(
    "undo",
  );
  expect(reviewShortcut({ ...event, shiftKey: true }, "/review", false, false)).toBe("redo");
  expect(reviewShortcut({ ...event, key: "y" }, "/review", false, false)).toBe("redo");
  for (const [path, sheet, composing] of [
    ["/play", false, false],
    ["/review", true, false],
    ["/review", false, true],
  ] as const)
    expect(reviewShortcut(event, path, sheet, composing)).toBeUndefined();
  expect(reviewShortcut({ ...event, isComposing: true }, "/review", false, false)).toBeUndefined();
  expect(reviewShortcut({ ...event, altKey: true }, "/review", false, false)).toBeUndefined();
});
