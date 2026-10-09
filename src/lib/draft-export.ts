import { draftFileName, serializeDraft } from "./draft";
import { workspace as appWorkspace, type Workspace } from "./store/workspace";

/**
 * Downloads the workspace's text as a draft file and counts it as saved. The download itself is
 * best effort: browsers may block or silently drop it, so callers never treat it as confirmation
 * that a copy exists. Throws when the draft cannot be serialised.
 */
export function exportDraft(workspace: Workspace = appWorkspace): void {
  const content = workspace.content();
  const blob = new Blob(
    [
      serializeDraft({
        detectedLanguage: content.detectedLanguage ?? "未指定",
        genreHint: content.genreHint?.trim() || undefined,
        segments: content.segments,
      }),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = draftFileName();
  link.click();
  // Give the browser time to start the download before releasing the file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  workspace.markSaved();
}
