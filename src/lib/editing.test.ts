import { expect, it } from "vitest";
import { History, splitNarration, textBudget } from "./editing";

it("preserves Unicode text while respecting both narration limits", () => {
  for (const text of [
    "故事開始。".repeat(150),
    "👨‍👩‍👧‍👦".repeat(200),
    "中".repeat(1000),
    "hello world! ".repeat(200),
  ]) {
    const parts = splitNarration(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => textBudget(p).valid)).toBe(true);
  }
  expect(textBudget("👨‍👩‍👧‍👦".repeat(100))).toMatchObject({ graphemes: 100, valid: false });
  expect(() => splitNarration("hello\u0000world")).toThrow();
});
it("coalesces typing, bounds history and invalidates redo on new edits", () => {
  const h = new History([{ text: "first" }], 2);
  h.commit([{ text: "second" }], "typing", 100);
  h.commit([{ text: "third" }], "typing", 200);
  expect(h.undo()).toEqual([{ text: "first" }]);
  expect(h.canRedo).toBe(true);
  h.commit([{ text: "replacement" }]);
  expect(h.canRedo).toBe(false);
  const copy = h.value;
  if (!copy[0]) throw new Error("Missing history value");
  copy[0].text = "mutation";
  expect(h.value[0]?.text).toBe("replacement");
  h.commit([{ text: "fourth" }]);
  h.commit([{ text: "fifth" }]);
  h.undo();
  h.undo();
  expect(h.canUndo).toBe(false);
});
