import { type Draft, parseDraft, serializeDraft } from "./draft";

export const AUTOSAVE_KEY = "bragi:autosave:v1";
export const AUTOSAVE_DELAY = 1000;

/** Only the versioned text payload crosses this boundary; storage may be unavailable. */
export class DraftAutosave {
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ) {}

  load(): Draft | undefined {
    try {
      const source = this.storage().getItem(AUTOSAVE_KEY);
      return source === null ? undefined : parseDraft(source);
    } catch {
      this.clear();
      return undefined;
    }
  }

  save(draft: Draft) {
    this.dispose();
    try {
      this.storage().setItem(AUTOSAVE_KEY, serializeDraft(draft));
    } catch {}
  }

  schedule(draft: Draft) {
    this.dispose();
    try {
      const source = serializeDraft(draft);
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        try {
          this.storage().setItem(AUTOSAVE_KEY, source);
        } catch {}
      }, AUTOSAVE_DELAY);
    } catch {}
  }

  clear() {
    this.dispose();
    try {
      this.storage().removeItem(AUTOSAVE_KEY);
    } catch {}
  }

  dispose() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
