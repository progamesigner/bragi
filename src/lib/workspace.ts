import { type Draft, serializeDraft } from "./draft";

export type Operation = {
  signal: AbortSignal;
  current: () => boolean;
};

/** A newer action invalidates every outcome of the previous action, including catch/finally. */
export class WorkspaceRevision {
  #controller?: AbortController;

  begin(): Operation {
    this.invalidate();
    const controller = new AbortController();
    this.#controller = controller;
    return {
      signal: controller.signal,
      current: () => this.#controller === controller && !controller.signal.aborted,
    };
  }

  invalidate() {
    this.#controller?.abort();
    this.#controller = undefined;
  }
}

/** Validation and confirmation finish before the caller atomically replaces its workspace. */
export function commitCandidate(
  operation: Operation,
  draft: Draft,
  hasDraft: boolean,
  confirm: () => boolean,
  commit: (draft: Draft) => void,
): boolean {
  if (!operation.current()) return false;
  serializeDraft(draft);
  if (hasDraft && !confirm()) return false;
  if (!operation.current()) return false;
  commit(draft);
  return true;
}
