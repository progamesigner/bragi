import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { serializeDraft } from "../draft";
import { History, textBudget } from "../editing";
import type { PreparedImage } from "../image";
import { type PlaybackSegment, playbackSegment } from "../playback";
import { type Segment, speechText } from "../state";

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
/** Throws when content may not be kept, e.g. it would exceed the draft limits. */
export type WorkspaceValidator = (content: WorkspaceContent) => void;

/** The draft limits: anything the workspace holds must stay exportable and autosavable. */
export const draftLimits: WorkspaceValidator = (content) => {
  serializeDraft({
    detectedLanguage: content.detectedLanguage ?? "未指定",
    genreHint: content.genreHint?.trim() || undefined,
    segments: content.segments,
  });
};

export function createWorkspace(validate: WorkspaceValidator = () => {}) {
  const [segments, setSegments] = createStore<Segment[]>([]);
  const [image, setImage] = createSignal<PreparedImage>();
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [genreHint, setGenreHint] = createSignal("");
  const [history, setHistory] = createSignal(new History<Segment[]>([]), { equals: false });
  const [savedSnapshot, setSavedSnapshot] = createSignal(EMPTY);
  const [historyRevision, setHistoryRevision] = createSignal(0);
  const [pendingInput, setPendingInput] = createSignal(false);
  const [currentSegment, setCurrentSegmentSignal] = createSignal(0);
  const [playbackRecords, setPlaybackRecords] = createSignal<
    (PlaybackSegment & { seconds: number })[]
  >([]);
  const played = () =>
    playbackRecords().filter((entry) =>
      segments.some((segment) => {
        const identity = playbackSegment(segment, genreHint().trim() || undefined);
        return identity.id === entry.id && identity.version === entry.version;
      }),
    );

  const content = (): WorkspaceContent => ({
    detectedLanguage: detectedLanguage(),
    genreHint: genreHint(),
    segments: [...segments],
  });

  function clampSegment(index: number) {
    return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, segments.length - 1));
  }

  function commitInput() {
    if (!pendingInput()) return;
    const next = [...segments];
    if (JSON.stringify(next) !== JSON.stringify(history().value)) {
      history().commit(next);
      setHistory(history());
    }
    history().endGroup();
    setPendingInput(false);
  }

  return {
    segments,
    image,
    detectedLanguage,
    genreHint,
    currentSegment,
    played,
    recordPlayback(identity: PlaybackSegment, seconds: number) {
      setPlaybackRecords((entries) => [
        ...entries.filter((entry) => entry.id !== identity.id),
        { ...identity, seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 },
      ]);
    },
    resetPlayback() {
      setPlaybackRecords([]);
      setCurrentSegmentSignal(0);
    },
    historyRevision,
    content,
    /** True once there is recognised or imported text to review. */
    hasDraft: () => detectedLanguage() !== undefined,
    /** Every segment has speakable text within the limits, so playback may start. */
    playable: () =>
      segments.length > 0 &&
      segments.every(
        (segment) => textBudget(segment.text).valid && textBudget(speechText(segment)).valid,
      ),
    canUndo: () => pendingInput() || history().canUndo,
    canRedo: () => !pendingInput() && history().canRedo,
    /** Content differs from the last recognised, imported or exported version. */
    dirty: () => snapshot(content()) !== savedSnapshot(),

    setImage,
    setGenreHint,

    /**
     * Replaces the draft (new recognition or import): fresh history, first segment. Pass
     * `saved: false` when no copy exists outside this tab (recognition, local recovery), so the
     * draft counts as unexported until it is exported.
     */
    load(next: WorkspaceContent, { saved = true }: { saved?: boolean } = {}) {
      batch(() => {
        setPendingInput(false);
        setDetectedLanguage(next.detectedLanguage);
        setGenreHint(next.genreHint ?? "");
        setSegments(reconcile(history().clone(next.segments)));
        setHistory(new History<Segment[]>(next.segments));
        setHistoryRevision((value) => value + 1);
        setCurrentSegmentSignal(0);
        setPlaybackRecords([]);
        setSavedSnapshot(saved ? snapshot(next) : EMPTY);
      });
    },

    /** Drops the draft but keeps the picture, e.g. when a new recognition starts. */
    discardDraft() {
      batch(() => {
        setPendingInput(false);
        setDetectedLanguage(undefined);
        setSegments(reconcile([]));
        setHistory(new History<Segment[]>([]));
        setHistoryRevision((value) => value + 1);
        setCurrentSegmentSignal(0);
        setPlaybackRecords([]);
        setSavedSnapshot(snapshot({ genreHint: genreHint(), segments: [] }));
      });
    },

    /** Empties everything: picture, draft, hint, history and playback position. */
    clear() {
      batch(() => {
        setImage(undefined);
        setGenreHint("");
        setPendingInput(false);
        setDetectedLanguage(undefined);
        setSegments(reconcile([]));
        setHistory(new History<Segment[]>([]));
        setHistoryRevision((value) => value + 1);
        setCurrentSegmentSignal(0);
        setPlaybackRecords([]);
        setSavedSnapshot(EMPTY);
      });
    },

    /** Live, validated input; native undo owns the focused field until commitInput/blur. */
    stageInput(next: Segment[]) {
      validate({ ...content(), segments: next });
      if (JSON.stringify(next) === JSON.stringify(segments)) return;
      batch(() => {
        setPendingInput(true);
        setHistoryRevision((value) => value + 1);
        setSegments(reconcile(history().clone(next)));
      });
    },
    commitInput,
    /** An edit; matching groups coalesce within 750ms. Validate before changing any history. */
    edit(next: Segment[], group?: string) {
      validate({ ...content(), segments: next });
      commitInput();
      history().commit(next, group);
      batch(() => {
        setHistory(history());
        setHistoryRevision((value) => value + 1);
        setSegments(reconcile(history().clone(next)));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    /** Steps back; throws, changing nothing, when that version fails validation. */
    undo() {
      commitInput();
      if (!history().canUndo) return;
      const previous = history().undo();
      try {
        validate({ ...content(), segments: previous });
      } catch (error) {
        history().redo();
        throw error;
      }
      batch(() => {
        setHistory(history());
        setHistoryRevision((value) => value + 1);
        setSegments(reconcile(previous));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    /** Steps forward; throws, changing nothing, when that version fails validation. */
    redo() {
      commitInput();
      if (!history().canRedo) return;
      const next = history().redo();
      try {
        validate({ ...content(), segments: next });
      } catch (error) {
        history().undo();
        throw error;
      }
      batch(() => {
        setHistory(history());
        setHistoryRevision((value) => value + 1);
        setSegments(reconcile(history().clone(next)));
        setCurrentSegmentSignal((index) => clampSegment(index));
      });
    },

    /** Call after exporting so the current content counts as saved. */
    markSaved() {
      commitInput();
      history().endGroup();
      setSavedSnapshot(snapshot(content()));
    },

    setCurrentSegment(index: number) {
      setCurrentSegmentSignal(clampSegment(index));
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;

/** The app's single workspace. */
export const workspace = createWorkspace(draftLimits);
