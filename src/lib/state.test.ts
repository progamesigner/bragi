import { describe, expect, it } from "vitest";
import { insertAfter, mergeWithNext, removeSegment, type Segment, splitAtCursor } from "./state";

const segments: Segment[] = [
  { id: "one", text: "第一段", suggestedToneHint: "平靜" },
  { id: "two", text: "第二段", suggestedToneHint: "緊張" },
  { id: "three", text: "第三段", suggestedToneHint: "" },
];

describe("review segment operations", () => {
  it("merges a segment with its next neighbor", () => {
    expect(mergeWithNext(segments, 0)).toEqual([
      { id: "one", text: "第一段\n\n第二段", suggestedToneHint: "平靜" },
      segments[2],
    ]);
  });

  it("splits text at the editor cursor", () => {
    expect(splitAtCursor(segments, 0, 2, "split")).toEqual([
      { id: "one", text: "第一", suggestedToneHint: "平靜" },
      { id: "split", text: "段", suggestedToneHint: "平靜" },
      segments[1],
      segments[2],
    ]);
    expect(() => splitAtCursor(segments, 0, 0, "split")).toThrow("游標");
  });

  it("inserts and removes editable segments", () => {
    const inserted = insertAfter(segments, 1, "new");
    expect(inserted[2]).toEqual({ id: "new", text: "", suggestedToneHint: "" });
    expect(removeSegment(inserted, 2)).toEqual(segments);
  });
});
