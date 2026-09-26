import { describe, expect, it } from "vitest";
import {
  insertAfter,
  mergeWithNext,
  removeSegment,
  type Segment,
  speechText,
  splitAtCursor,
  withSpokenText,
} from "./state";

const first: Segment = { id: "one", text: "第一段", suggestedToneHint: "平靜" };
const second: Segment = { id: "two", text: "第二段", suggestedToneHint: "緊張" };
const segments: Segment[] = [first, second, { id: "three", text: "第三段", suggestedToneHint: "" }];

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

  it("speaks a correction without changing the displayed transcript", () => {
    const corrected = withSpokenText(first, "第壹段");
    expect(corrected.text).toBe("第一段");
    expect(speechText(corrected)).toBe("第壹段");
    expect(speechText(withSpokenText(corrected, undefined))).toBe("第一段");
    expect(withSpokenText(corrected, undefined)).not.toHaveProperty("spokenText");
    expect(speechText(withSpokenText(first, ""))).toBe("");
  });

  it("merges spoken corrections with the neighbor's effective speech", () => {
    const merged = mergeWithNext([withSpokenText(first, "第壹段"), second], 0);
    expect(merged[0]).toMatchObject({ text: "第一段\n\n第二段", spokenText: "第壹段\n\n第二段" });
    expect(mergeWithNext(segments, 0)[0]).not.toHaveProperty("spokenText");
  });

  it("drops a spoken correction that no longer matches either split half", () => {
    const split = splitAtCursor([withSpokenText(first, "第壹段")], 0, 2, "split");
    expect(split).toEqual([
      { id: "one", text: "第一", suggestedToneHint: "平靜" },
      { id: "split", text: "段", suggestedToneHint: "平靜" },
    ]);
  });
});
