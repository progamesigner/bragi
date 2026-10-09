import { t } from "./i18n";
import { ttsRequestSchema } from "./schemas";

export function textBudget(text: string) {
  return {
    graphemes: [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.trim())]
      .length,
    bytes: new TextEncoder().encode(text.trim()).length,
    valid: ttsRequestSchema.safeParse({ text }).success,
  };
}

export function splitNarration(text: string): string[] {
  if (!text.trim()) return [];
  const output: string[] = [];
  let current = "";
  const units = [...new Intl.Segmenter("zh", { granularity: "sentence" }).segment(text)].flatMap(
    ({ segment }) =>
      textBudget(segment).valid
        ? [segment]
        : [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(segment)].map(
            (part) => part.segment,
          ),
  );
  for (const unit of units) {
    if (current.trim() && !textBudget(current + unit).valid) {
      output.push(current);
      current = "";
    }
    current += unit;
    if (!textBudget(current).valid && current.trim())
      throw new Error(t("review.controlCharacters"));
  }
  if (current) output.push(current);
  return output;
}

export class History<T> {
  #past: T[] = [];
  #future: T[] = [];
  #current: T;
  #group?: string;
  #time = 0;
  constructor(
    initial: T,
    readonly limit = 100,
  ) {
    this.#current = this.clone(initial);
  }
  clone(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
  get canUndo() {
    return this.#past.length > 0;
  }
  get canRedo() {
    return this.#future.length > 0;
  }
  get value() {
    return this.clone(this.#current);
  }
  commit(value: T, group?: string, time = performance.now()) {
    if (!group || group !== this.#group || time - this.#time > 750) {
      this.#past.push(this.clone(this.#current));
      if (this.#past.length > this.limit) this.#past.shift();
    }
    this.#current = this.clone(value);
    this.#future = [];
    this.#group = group;
    this.#time = time;
  }
  undo() {
    const previous = this.#past.pop();
    if (previous !== undefined) {
      this.#future.push(this.#current);
      this.#current = previous;
    }
    this.#group = undefined;
    return this.value;
  }
  redo() {
    const next = this.#future.pop();
    if (next !== undefined) {
      this.#past.push(this.#current);
      this.#current = next;
    }
    this.#group = undefined;
    return this.value;
  }
}
