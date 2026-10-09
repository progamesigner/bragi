import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { History } from "../editing";
import type { PreparedImage } from "../image";
import type { Segment } from "../state";

/** The text content a draft carries; the image never leaves the device's memory. */
export type WorkspaceContent = {
  detectedLanguage?: string;
  genreHint?: string;
  segments: Segment[];
};

function snapshot(content: WorkspaceContent): string {
  return JSON.stringify([
    content.detectedLanguage ?? "",
    content.genreHint?.trim() ?? "",
    content.segments,
  ]);
}

const EMPTY = snapshot({ segments: [] });

/**
 * The script being worked on: picture, recognised segments, edit history, the last saved state
 * (for "unsaved changes") and the segment playback is on. It belongs to the app, not to a screen,
 * so routing between capture, review and playback keeps all of it. Every change goes through the
 * methods here so history and the dirty flag cannot drift from the segments.
 */
export function createWorkspace() {
  const [segments, setSegments] = createStore<Segment[]>([]);
  const [image, setImage] = createSignal<PreparedImage>();
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [genreHint, setGenreHint] = createSignal("");
  const [history, setHistory] = createSignal(new History<Segment[]>([]), { equals: false });
  const [savedSnapshot, setSavedSnapshot] = createSignal(EMPTY);
  const [currentSegment, setCurrentSegmentSignal] = createSignal(0);

  const content = (): WorkspaceContent => ({
    detectedLanguage: detectedLanguage(),
    genreHint: genreHint(),
    segments: [...segments],
  });

  function clampSegment(index: number) {
    return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, segments.length - 1));
  }

  return {
    segments,
    image,
    detectedLanguage,
    genreHint,
    currentSegment,
    content,
    /** True once there is recognised or imported text to review. */
    hasDraft: () => detectedLanguage() !== undefined,
    canUndo: () => history().canUndo,
    canRedo: () => history().canRedo,
    /** Content differs from the last recognised, imported or exported version. */
    dirty: () => snapshot(content()) !== savedSnapshot(),

    setImage,
    setGenreHint,

    /** Replaces the draft (new recognition or import): fresh history, first segment, saved. */
    load(next: WorkspaceContent) {
      batch(() => {
        setDetectedLanguage(next.detectedLanguage);
        setGenreHint(next.genreHint ?? "");
        setSegments(reconcile(next.segments));
        setHistory(new History<Segment[]>(next.segments));
        setCurrentSegmentSignal(0);
        setSavedSnapshot(snapshot(next));
      });
    },

    /** Drops the draft but keeps the picture, e.g. when a new recognition starts. */
    discardDraft() {
      batch(() => {
        setDetectedLanguage(undefined);
        setSegments(reconcile([]));
        setHistory(new History<Segment[]>([]));
        setCurrentSegmentSignal(0);
        setSavedSnapshot(snapshot({ genreHint: genreHint(), segments: [] }));
      });
    },

    /** Empties everything: picture, draft, hint, history and playback position. */
    clear() {
      batch(() => {
        setImage(undefined);
        setGenreHint("");
        setDetectedLanguage(undefined);
        setSegments(reconcile([]));
        setHistory(new History<Segment[]>([]));
        setCurrentSegmentSignal(0);
        setSavedSnapshot(EMPTY);
      });
    },

    /** An edit; edits sharing a `group` within a short time undo together (typing). */
    edit(next: Segment[], group?: string) {
      history().commit(next, group);
      batch(() => {
        setHistory(history());
        setSegments(reconcile(next));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    undo() {
      const previous = history().undo();
      batch(() => {
        setHistory(history());
        setSegments(reconcile(previous));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    redo() {
      const next = history().redo();
      batch(() => {
        setHistory(history());
        setSegments(reconcile(next));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    /** Call after exporting so the current content counts as saved. */
    markSaved() {
      setSavedSnapshot(snapshot(content()));
    },

    setCurrentSegment(index: number) {
      setCurrentSegmentSignal(clampSegment(index));
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;

/** The app's single workspace. */
export const workspace = createWorkspace();
