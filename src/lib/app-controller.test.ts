import type { Location, Navigator } from "@solidjs/router";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppController, createAppController } from "./app-controller";
import { type Draft, serializeDraft } from "./draft";
import { exportDraft } from "./draft-export";
import type { PreparedImage } from "./image";
import { workspace } from "./store/workspace";

vi.mock("./draft-export", () => ({ exportDraft: vi.fn(() => workspace.markSaved()) }));

const original: Draft = {
  detectedLanguage: "zh",
  segments: [{ id: "old", text: "舊稿", suggestedToneHint: "" }],
};
const replacement: Draft = {
  detectedLanguage: "en",
  segments: [{ id: "new", text: "New draft", suggestedToneHint: "" }],
};
const prepared = (): PreparedImage => ({
  file: new File(["image"], "candidate.png", { type: "image/png" }),
  transformed: false,
});
const input = (draft = replacement) =>
  ({
    files: [new File([serializeDraft(draft)], "draft.json")],
    value: "draft.json",
  }) as unknown as HTMLInputElement;
let app: AppController;
let dispose: () => void;
let navigate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  workspace.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json =
        url === "/api/uploads"
          ? { uploadId: "test", target: { url: "/upload", method: "POST", headers: {} } }
          : url === "/api/ocr"
            ? replacement
            : {};
      return new Response(JSON.stringify(json), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  navigate = vi.fn();
  app = createRoot((cleanup) => {
    dispose = cleanup;
    return createAppController(navigate as Navigator, { pathname: "/", state: null } as Location);
  });
});
afterEach(() => {
  dispose();
  workspace.clear();
  vi.unstubAllGlobals();
});

function start(action: "import" | "replace") {
  if (action === "import") return app.importDraft(input());
  return app.recognize();
}
function withOldContent() {
  workspace.load(original);
  workspace.edit([{ id: "old", text: "已編輯", suggestedToneHint: "" }]);
  workspace.setImage(prepared());
  app.selectCandidate();
  const image = prepared();
  app.setCandidate(image);
  return image;
}

for (const action of ["import", "replace"] as const) {
  describe(`${action} loss confirmation`, () => {
    it("retains the validated candidate while export only saves the old draft", async () => {
      const image = withOldContent();
      const pending = start(action);
      await vi.waitFor(() => expect(app.pendingLoss()).toBe(action));
      expect(workspace.segments[0]?.text).toBe("已編輯");
      expect(workspace.canUndo()).toBe(true);
      expect(app.candidate()).toBe(image);
      expect(app.exportForLoss()).toBe(true);
      expect(exportDraft).toHaveBeenCalledOnce();
      expect(workspace.segments[0]?.text).toBe("已編輯");
      expect(app.pendingLoss()).toBe(action);
      app.perform(action);
      await pending;
      expect(workspace.segments[0]?.text).toBe("New draft");
      expect(workspace.canUndo()).toBe(false);
      expect(workspace.image()).toBe(action === "replace" ? image : undefined);
      expect(app.candidate()).toBeUndefined();
      expect(navigate).toHaveBeenCalledWith("/review", expect.anything());
    });

    it("keeps edits, history and candidate image on cancel, then permits retry", async () => {
      const image = withOldContent();
      const pending = start(action);
      await vi.waitFor(() => expect(app.pendingLoss()).toBe(action));
      app.cancelLoss();
      await pending;
      expect(workspace.segments[0]?.text).toBe("已編輯");
      expect(workspace.canUndo()).toBe(true);
      expect(app.candidate()).toBe(image);
      expect(app.recognitionBusy()).toBe(false);
      const retry = start(action);
      await vi.waitFor(() => expect(app.pendingLoss()).toBe(action));
      app.perform(action);
      await retry;
      expect(workspace.segments[0]?.text).toBe("New draft");
    });

    it.each(["clear", "signOut", "import", "recognize", "candidate", "update"])(
      "discards a waiting candidate when %s supersedes it",
      async (newAction) => {
        withOldContent();
        const pending = start(action);
        await vi.waitFor(() => expect(app.pendingLoss()).toBe(action));
        let next: Promise<void> | undefined;
        if (newAction === "clear" || newAction === "signOut" || newAction === "update")
          app.perform(newAction);
        else if (newAction === "candidate") app.selectCandidate();
        else if (newAction === "import")
          next = app.importDraft(
            input({
              ...replacement,
              segments: [{ id: "latest", text: "Latest", suggestedToneHint: "" }],
            }),
          );
        else next = app.recognize();
        await pending;
        if (next) {
          await vi.waitFor(() =>
            expect(app.pendingLoss()).toBe(newAction === "import" ? "import" : "replace"),
          );
          app.cancelLoss();
          await next;
        }
        app.perform(action);
        expect(workspace.segments.some((segment) => segment.id === "new")).toBe(false);
        expect(app.pendingLoss()).toBeUndefined();
      },
    );

    it("submits directly when no existing content is discarded", async () => {
      if (action === "replace") {
        app.selectCandidate();
        app.setCandidate(prepared());
      }
      await start(action);
      expect(workspace.segments[0]?.text).toBe("New draft");
      expect(app.pendingLoss()).toBeUndefined();
    });
  });
}

it.each(["image", "history", "candidate", "genre"])(
  "asks before importing over %s without a draft",
  async (content) => {
    if (content === "image") workspace.setImage(prepared());
    if (content === "history") workspace.edit(original.segments);
    if (content === "candidate") {
      app.selectCandidate();
      app.setCandidate(prepared());
    }
    if (content === "genre") workspace.setGenreHint("奇幻");
    const pending = app.importDraft(input());
    await vi.waitFor(() => expect(app.pendingLoss()).toBe("import"));
    app.cancelLoss();
    await pending;
    expect(workspace.hasDraft()).toBe(false);
  },
);

it("rechecks the revision even if a new candidate arrives just after acceptance", async () => {
  withOldContent();
  const pending = app.importDraft(input());
  await vi.waitFor(() => expect(app.pendingLoss()).toBe("import"));
  app.perform("import");
  app.selectCandidate();
  await pending;
  expect(workspace.segments[0]?.text).toBe("已編輯");
});

it("first recognition retains an existing genre hint without asking", async () => {
  workspace.setGenreHint("奇幻");
  app.selectCandidate();
  app.setCandidate(prepared());
  await app.recognize();
  expect(workspace.genreHint()).toBe("奇幻");
  expect(workspace.segments[0]?.text).toBe("New draft");
  expect(app.pendingLoss()).toBeUndefined();
});
