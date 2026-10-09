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
  it("keeps the whole old workspace on rejection or invalid OCR", async () => {
    const revisions = new WorkspaceRevision();
    const history = new History(original.segments);
    history.commit([{ id: "one", suggestedToneHint: "平靜", text: "已編輯" }]);
    const workspace = { image: "old.png", draft: original, history, dirty: true };
    const commit = vi.fn();
    expect(await commitCandidate(revisions.begin(), candidate, true, () => false, commit)).toBe(
      false,
    );
    await expect(
      commitCandidate(
        revisions.begin(),
        { ...candidate, detectedLanguage: "" },
        true,
        () => true,
        commit,
      ),
    ).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
    expect(workspace.image).toBe("old.png");
    expect(workspace.history.canUndo).toBe(true);
    expect(workspace.dirty).toBe(true);
  });

  it("confirms only when content would be lost and commits once", async () => {
    const revisions = new WorkspaceRevision();
    const confirm = vi.fn(() => true);
    const commit = vi.fn();
    expect(await commitCandidate(revisions.begin(), candidate, false, confirm, commit)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(await commitCandidate(revisions.begin(), candidate, true, confirm, commit)).toBe(true);
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
    expect(await commitCandidate(old, candidate, true, confirm, commit)).toBe(false);
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
    expect(await commitCandidate(next, candidate, false, confirm, commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each(["clear", "signOut", "request", "candidate"])(
    "rechecks the revision after asynchronous confirmation invalidated by %s",
    async (action) => {
      const revisions = new WorkspaceRevision();
      let accept!: (accepted: boolean) => void;
      const confirmation = new Promise<boolean>((resolve) => {
        accept = resolve;
      });
      const commit = vi.fn();
      const pending = commitCandidate(
        revisions.begin(),
        candidate,
        true,
        () => confirmation,
        commit,
      );
      expect(commit).not.toHaveBeenCalled();
      if (action === "request" || action === "candidate") revisions.begin();
      else revisions.invalidate();
      accept(true);
      expect(await pending).toBe(false);
      expect(commit).not.toHaveBeenCalled();
    },
  );
});
