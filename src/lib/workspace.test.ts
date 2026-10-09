import { describe, expect, it, vi } from "vitest";
import type { Draft } from "./draft";
import { History } from "./editing";
import { commitCandidate, WorkspaceRevision } from "./workspace";

const original: Draft = {
  detectedLanguage: "zh",
  genreHint: "奇幻",
  segments: [{ id: "one", text: "舊稿", suggestedToneHint: "平靜" }],
};
const candidate: Draft = {
  detectedLanguage: "en",
  genreHint: "懸疑",
  segments: [{ id: "new", text: "New draft", suggestedToneHint: "" }],
};

describe("candidate workspace transactions", () => {
  it("keeps the whole old workspace on rejection or invalid OCR", () => {
    const revisions = new WorkspaceRevision();
    const history = new History(original.segments);
    history.commit([{ id: "one", suggestedToneHint: "平靜", text: "已編輯" }]);
    const workspace = { image: "old.png", draft: original, history, dirty: true };
    const commit = vi.fn();
    expect(commitCandidate(revisions.begin(), candidate, true, () => false, commit)).toBe(false);
    expect(() =>
      commitCandidate(
        revisions.begin(),
        { ...candidate, detectedLanguage: "" },
        true,
        () => true,
        commit,
      ),
    ).toThrow();
    expect(commit).not.toHaveBeenCalled();
    expect(workspace.image).toBe("old.png");
    expect(workspace.history.canUndo).toBe(true);
    expect(workspace.dirty).toBe(true);
  });

  it("confirms only when a draft would be lost and commits once", () => {
    const revisions = new WorkspaceRevision();
    const confirm = vi.fn(() => true);
    const commit = vi.fn();
    expect(commitCandidate(revisions.begin(), candidate, false, confirm, commit)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(commitCandidate(revisions.begin(), candidate, true, confirm, commit)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(candidate);
  });

  it("drops late success, errors and finally after clear or a newer action", async () => {
    const revisions = new WorkspaceRevision();
    const old = revisions.begin();
    const next = revisions.begin();
    const confirm = vi.fn(() => true);
    const commit = vi.fn();
    expect(old.signal.aborted).toBe(true);
    expect(commitCandidate(old, candidate, true, confirm, commit)).toBe(false);
    const status = vi.fn();
    try {
      await Promise.reject(new Error("late failure"));
    } catch {
      if (old.current()) status("error");
    } finally {
      if (old.current()) status("idle");
    }
    expect(status).not.toHaveBeenCalled();
    revisions.invalidate();
    expect(commitCandidate(next, candidate, false, confirm, commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
