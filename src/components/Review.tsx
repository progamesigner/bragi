import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ToastAction } from "~/lib/app-controller";
import { serializeDraft } from "~/lib/draft";
import { exportDraft as downloadDraft } from "~/lib/draft-export";
import { MAX_DRAFT_SEGMENTS } from "~/lib/draft-limits";
import { splitNarration, textBudget } from "~/lib/editing";
import { languageName, t } from "~/lib/i18n";
import { useWideLayout } from "~/lib/layout";
import { reviewShortcut, reviewTarget } from "~/lib/review-editing";
import {
  insertAfter,
  mergeWithNext,
  removeSegment,
  type Segment,
  speechText,
  splitAtCursor,
  withSpokenText,
} from "~/lib/state";
import type { StatusReporter } from "~/lib/status";
import { workspace } from "~/lib/store/workspace";
import ReviewImage from "./ReviewImage";
import SpeechPreview from "./SpeechPreview";
import Button from "./ui/Button";
import Sheet from "./ui/Sheet";

export type ReviewPosition = {
  scroll: number;
  expanded?: string;
  activeId?: string;
  field?: "text" | "spoken" | "tone";
};

type ReviewProps = {
  position?: ReviewPosition;
  onRememberPosition: (position: ReviewPosition) => void;
  requestRevision?: object;
  detectedLanguage: string;
  image?: File;
  genreHint?: string;
  voice?: string;
  onStartPlayback: () => void;
  onReturnReview: () => void;
  /** Errors; successes go to `onToast`. */
  onStatus: StatusReporter;
  onToast: (message: string, action?: ToastAction) => void;
};

export default function Review(props: ReviewProps) {
  const wide = useWideLayout();
  let section!: HTMLElement;
  let footer!: HTMLDivElement;
  const [expanded, setExpanded] = createSignal<string | undefined>(props.position?.expanded);
  const [activeId, setActiveId] = createSignal<string | undefined>(props.position?.activeId);
  const [activeField, setActiveField] = createSignal<"text" | "spoken" | "tone">(
    props.position?.field ?? "text",
  );
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const [imageOpen, setImageOpen] = createSignal(false);
  const [composing, setComposing] = createSignal(false);
  type Input = HTMLInputElement | HTMLTextAreaElement;
  const inputSessions = new WeakMap<
    Input,
    { baseline: string; nativeEvents: number; redo: boolean }
  >();
  let pendingJump: string | undefined;
  let shortcutTimer: ReturnType<typeof setTimeout> | undefined;
  const issue = (segment: Segment) =>
    !textBudget(segment.text).valid || !textBudget(speechText(segment)).valid;

  function focusSegment(id?: string, field: "text" | "spoken" | "tone" = "text", formerIndex = 0) {
    const target = reviewTarget(workspace.segments, id, formerIndex);
    if (!target) return;
    setActiveId(target);
    if (field !== "text") setExpanded(target);
    requestAnimationFrame(() => {
      const editor =
        document.getElementById(`segment-${field}-${target}`) ??
        document.getElementById(`segment-text-${target}`);
      editor?.scrollIntoView({ block: "center" });
      editor?.focus({ preventScroll: true });
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)
        inputSessions.set(editor, { baseline: editor.value, nativeEvents: 0, redo: false });
    });
  }
  function jump(id: string) {
    if (navigationOpen()) {
      // Native dialog close first returns focus to its opener; only then focus the target.
      pendingJump = id;
      document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
    } else focusSegment(id);
  }
  const segmentNavigation = () => (
    <nav class="review-navigation" aria-label={t("review.segmentList")}>
      <ol>
        <For each={workspace.segments}>
          {(segment, index) => (
            <li>
              <Button
                variant="ghost"
                size="compact"
                class="review-jump"
                aria-current={activeId() === segment.id ? "location" : undefined}
                onClick={() => jump(segment.id)}
              >
                <span>{index() + 1}</span>
                <span class="segment-excerpt">
                  {segment.text.trim() || t("review.emptyExcerpt")}
                </span>
                <Show when={issue(segment)}>
                  <span class="field-error">{t("review.issueMark")}</span>
                </Show>
              </Button>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
  const firstIssue = () =>
    workspace.segments.findIndex(
      (segment) => !textBudget(segment.text).valid || !textBudget(speechText(segment)).valid,
    );
  function focusIssue() {
    const segment = workspace.segments[firstIssue()];
    if (!segment) return;
    const field = textBudget(segment.text).valid ? "spoken" : "text";
    focusSegment(segment.id, field);
  }
  onMount(() => {
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty(
        "--review-action-height",
        `${footer.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    measure();
    const viewport = window.visualViewport;
    const keyboard = () => {
      const inset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      const focused = document.activeElement;
      if (
        inset &&
        focused instanceof HTMLElement &&
        section.contains(focused) &&
        focused.matches("input, textarea")
      ) {
        focused.scrollIntoView({ block: "center" });
        const bounds = focused.getBoundingClientRect();
        const visibleTop = (viewport?.offsetTop ?? 0) + 88;
        const visibleBottom =
          (viewport?.offsetTop ?? 0) +
          (viewport?.height ?? window.innerHeight) -
          footer.getBoundingClientRect().height -
          16;
        if (bounds.bottom > visibleBottom) window.scrollBy(0, bounds.bottom - visibleBottom);
        else if (bounds.top < visibleTop) window.scrollBy(0, bounds.top - visibleTop);
      }
    };
    viewport?.addEventListener("resize", keyboard);
    viewport?.addEventListener("scroll", keyboard);
    onCleanup(() => {
      observer.disconnect();
      viewport?.removeEventListener("resize", keyboard);
      viewport?.removeEventListener("scroll", keyboard);
      root.style.removeProperty("--review-action-height");
      root.style.removeProperty("--keyboard-inset");
    });
  });
  const [imageUrl, setImageUrl] = createSignal<string>();

  createEffect(() => {
    const file = props.image;

    if (!file) {
      setImageUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    onCleanup(() => URL.revokeObjectURL(url));
  });
  let heading!: HTMLHeadingElement;
  const restore = (redo = false) => {
    if (composing()) return;
    const id = activeId();
    const index = workspace.segments.findIndex((segment) => segment.id === id);
    try {
      if (redo) workspace.redo();
      else workspace.undo();
      if (!section.isConnected) props.onReturnReview();
      focusSegment(id, activeField(), Math.max(0, index));
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.restoreFailed"), "error");
    }
  };
  function focusSnapshot(id: string) {
    const field = activeId() === id ? activeField() : "text";
    const element = document.getElementById(`segment-${field}-${id}`);
    return {
      id,
      scroll: window.scrollY,
      expanded: expanded(),
      field,
      start: element instanceof HTMLTextAreaElement ? element.selectionStart : 0,
      end: element instanceof HTMLTextAreaElement ? element.selectionEnd : 0,
    };
  }
  const undoAction = (origin?: ReturnType<typeof focusSnapshot>): ToastAction => {
    const revision = workspace.historyRevision();
    const valid = () => workspace.historyRevision() === revision && workspace.canUndo();
    return {
      label: t("review.undo"),
      valid,
      run: () => {
        if (!valid()) return;
        restore();
        if (origin) {
          setExpanded(origin.expanded);
          setActiveId(origin.id);
          requestAnimationFrame(() => {
            const editor = document.getElementById(`segment-${origin.field}-${origin.id}`);
            editor?.focus({ preventScroll: true });
            if (editor instanceof HTMLTextAreaElement)
              editor.setSelectionRange(origin.start, origin.end);
            window.scrollTo(0, origin.scroll);
          });
        }
      },
    };
  };

  // Without scrolling, so returning to review can restore where it was.
  onMount(() => heading.focus({ preventScroll: true }));

  function replaceSegments(segments: Segment[], group?: string) {
    if (composing()) return false;
    try {
      if (group) workspace.stageInput(segments);
      else workspace.edit(segments);
      return true;
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.editFailed"), "error");
      return false;
    }
  }

  const canAdd = createMemo(() => {
    if (workspace.segments.length >= MAX_DRAFT_SEGMENTS) return false;
    try {
      serializeDraft({
        detectedLanguage: props.detectedLanguage,
        genreHint: props.genreHint,
        segments: insertAfter(workspace.segments, workspace.segments.length - 1),
      });
      return true;
    } catch {
      return false;
    }
  });

  function edit(index: number, field: "text" | "suggestedToneHint", value: string) {
    return replaceSegments(
      workspace.segments.map((segment, position) =>
        position === index ? { ...segment, [field]: value } : { ...segment },
      ),
      `${workspace.segments[index]?.id}:${field}`,
    );
  }
  function editSpokenText(index: number, value: string | undefined) {
    return replaceSegments(
      workspace.segments.map((segment, position) =>
        position === index ? withSpokenText(segment, value) : { ...segment },
      ),
      value === undefined ? undefined : `${workspace.segments[index]?.id}:spokenText`,
    );
  }
  function autoSplit(index: number) {
    const segment = workspace.segments[index];
    if (!segment) return;
    const origin = focusSnapshot(segment.id);
    try {
      const parts = splitNarration(segment.text);
      if (parts.length < 2) {
        props.onToast(t("review.alreadyShort"));
        return;
      }
      const changed = replaceSegments([
        ...workspace.segments.slice(0, index),
        ...parts.map((text, i) =>
          withSpokenText(
            { ...segment, id: i === 0 ? segment.id : `segment-${crypto.randomUUID()}`, text },
            undefined,
          ),
        ),
        ...workspace.segments.slice(index + 1),
      ]);
      if (!changed) return;
      props.onToast(
        `${t("review.autoSplitDone", { n: parts.length })}${spokenCorrectionNotice(segment)}`,
        undoAction(origin),
      );
      focusSegment(segment.id);
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.autoSplitFailed"), "error");
    }
  }
  function exportDraft() {
    if (composing()) return;
    try {
      downloadDraft();
      props.onToast(t("draft.exported"));
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("draft.exportFailed"), "error");
    }
  }
  function spokenCorrectionNotice(segment: Segment) {
    return segment.spokenText === undefined ? "" : t("review.spokenReset");
  }
  function split(index: number, editor: HTMLTextAreaElement) {
    const segment = workspace.segments[index];
    if (composing() || !segment) return;
    const origin = focusSnapshot(segment.id);
    try {
      if (!replaceSegments(splitAtCursor(workspace.segments, index, editor.selectionStart))) return;
      props.onToast(
        `${t("review.splitDone")}${segment ? spokenCorrectionNotice(segment) : ""}`,
        undoAction(origin),
      );
      focusSegment(segment.id);
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.splitFailed"), "error");
      editor.focus();
    }
  }

  function inputEvents(index: () => number, field: "text" | "suggestedToneHint" | "spokenText") {
    const update = (input: Input) => {
      const segment = workspace.segments[index()];
      if (!segment) return;
      const accepted =
        field === "spokenText"
          ? editSpokenText(index(), input.value)
          : edit(index(), field, input.value);
      if (!accepted)
        input.value = field === "spokenText" ? (segment.spokenText ?? "") : segment[field];
    };
    return {
      onFocus: (event: FocusEvent & { currentTarget: Input }) => {
        setActiveId(workspace.segments[index()]?.id);
        setActiveField(
          field === "spokenText" ? "spoken" : field === "suggestedToneHint" ? "tone" : "text",
        );
        inputSessions.set(event.currentTarget, {
          baseline: event.currentTarget.value,
          nativeEvents: 0,
          redo: false,
        });
      },
      onInput: (event: InputEvent & { currentTarget: Input }) => {
        const session = inputSessions.get(event.currentTarget);
        if (session) {
          if (event.inputType === "historyUndo" || event.inputType === "historyRedo")
            session.nativeEvents++;
          session.redo = event.inputType === "historyUndo";
        }
        if (!composing() && !event.isComposing) update(event.currentTarget);
      },
      onCompositionStart: (_event: CompositionEvent & { currentTarget: Input }) => {
        setComposing(true);
      },
      onCompositionEnd: (event: CompositionEvent & { currentTarget: Input }) => {
        setComposing(false);
        update(event.currentTarget);
        if (document.activeElement !== event.currentTarget) workspace.commitInput();
      },
      onBlur: (event: FocusEvent & { currentTarget: Input }) => {
        if (!composing()) workspace.commitInput();
        inputSessions.delete(event.currentTarget);
      },
    };
  }

  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      const action = reviewShortcut(
        event,
        window.location.pathname,
        !!document.querySelector("dialog[open]"),
        composing(),
      );
      if (!action || event.defaultPrevented) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      const field = document.activeElement;
      const session =
        field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
          ? inputSessions.get(field)
          : undefined;
      // 1. Uncommitted focused input gets the browser's native undo/redo.
      // 2. Observe its history input event. No native event means no native undo was available:
      //    commit the field, then perform exactly one workspace action on the next task.
      // 3. A committed field/non-input goes directly to workspace History.
      if (
        session &&
        field instanceof HTMLElement &&
        (session.baseline !== (field as Input).value || (action === "redo" && session.redo))
      ) {
        const before = session.nativeEvents;
        clearTimeout(shortcutTimer);
        shortcutTimer = setTimeout(() => {
          if (
            session.nativeEvents !== before ||
            composing() ||
            document.querySelector("dialog[open]") ||
            !section.isConnected
          )
            return;
          workspace.commitInput();
          restore(action === "redo");
        }, 0);
      } else {
        event.preventDefault();
        workspace.commitInput();
        restore(action === "redo");
      }
    };
    window.addEventListener("keydown", keydown);
    onCleanup(() => {
      props.onRememberPosition({
        scroll: window.scrollY,
        expanded: expanded(),
        activeId: activeId(),
        field: activeField(),
      });
      clearTimeout(shortcutTimer);
      window.removeEventListener("keydown", keydown);
      // Do not submit a partially composed value when routing unmounts the editor.
      if (!composing()) workspace.commitInput();
    });
  });

  return (
    <section
      ref={section}
      class="card review"
      classList={{ "has-image": !!props.image }}
      aria-labelledby="review-heading"
      onKeyDown={(event) => {
        if (event.repeat && event.target instanceof HTMLElement && event.target.closest("button"))
          event.preventDefault();
      }}
    >
      <div class="review-heading">
        <div>
          <h1 ref={heading} id="review-heading" tabindex="-1">
            {t("review.heading")}
          </h1>
          <p>
            {t("review.summary", {
              language: languageName(props.detectedLanguage),
              n: workspace.segments.length,
            })}
          </p>
          <Show when={workspace.dirty()}>
            <p
              class="draft-dirty"
              title={t("review.savedLocally")}
              aria-describedby="draft-save-detail"
            >
              {t("review.dirty")}
            </p>
            <span id="draft-save-detail" class="visually-hidden">
              {t("review.savedLocally")}
            </span>
          </Show>
        </div>
        <div class="review-heading-actions">
          <Show when={!wide()}>
            <Button variant="secondary" size="compact" onClick={() => setNavigationOpen(true)}>
              {t("review.segmentList")}
            </Button>
          </Show>
          <Show when={!wide() && imageUrl()}>
            <Button variant="ghost" size="compact" onClick={() => setImageOpen(true)}>
              {t("review.compare")}
            </Button>
          </Show>
          <Button
            variant="secondary"
            size="compact"
            disabled={composing() || !workspace.canUndo()}
            onClick={() => restore()}
          >
            {t("review.undo")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={composing() || !workspace.canRedo()}
            onClick={() => restore(true)}
          >
            {t("review.redo")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={composing() || !canAdd()}
            aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
            onClick={() =>
              replaceSegments(insertAfter(workspace.segments, workspace.segments.length - 1))
            }
          >
            {t("review.addSegment")}
          </Button>
          <Button variant="secondary" size="compact" disabled={composing()} onClick={exportDraft}>
            {t("review.export")}
          </Button>
        </div>
      </div>

      <Show when={!canAdd()}>
        <p id="draft-limit-note" class="field-error">
          {t("review.limitReached")}
        </p>
      </Show>

      <div class="review-layout">
        <Show when={wide()}>
          <aside class="review-sidebar">
            <h2>{t("review.segmentList")}</h2>
            {segmentNavigation()}
            <Show when={imageUrl()}>
              {(url) => (
                <details class="image-comparison" open>
                  <summary>{t("review.compare")}</summary>
                  <ReviewImage url={url()} />
                </details>
              )}
            </Show>
          </aside>
        </Show>
        <Show when={!props.image}>
          <p class="review-no-image">{t("review.noImage")}</p>
        </Show>
        <Show
          when={workspace.segments.length > 0}
          fallback={<p class="empty-state">{t("review.empty")}</p>}
        >
          <ol class="review-segments">
            <For each={workspace.segments}>
              {(segment, index) => {
                let editor!: HTMLTextAreaElement;
                return (
                  <li
                    class="review-segment"
                    data-segment-id={segment.id}
                    onFocusIn={(event) => {
                      if (activeId() !== segment.id) setActiveField("text");
                      setActiveId(segment.id);
                      // Moving an earlier card during a button's pointerdown would cancel its
                      // eventual click. Buttons switch expansion only after activation.
                      if (
                        event.target instanceof HTMLElement &&
                        event.target.matches("input, textarea") &&
                        !composing() &&
                        expanded() &&
                        expanded() !== segment.id
                      )
                        setExpanded(undefined);
                    }}
                    classList={{
                      "segment-expanded": expanded() === segment.id,
                      "segment-invalid": issue(segment),
                    }}
                  >
                    <div class="segment-number">{t("review.segment", { n: index() + 1 })}</div>
                    <label for={`segment-text-${segment.id}`}>{t("review.text")}</label>
                    <textarea
                      ref={editor}
                      id={`segment-text-${segment.id}`}
                      rows="4"
                      value={segment.text}
                      classList={{ invalid: !textBudget(segment.text).valid }}
                      aria-invalid={!textBudget(segment.text).valid}
                      aria-describedby={
                        !textBudget(segment.text).valid
                          ? `segment-text-error-${segment.id}`
                          : undefined
                      }
                      {...inputEvents(index, "text")}
                    />
                    <p class="text-budget">
                      {t("review.budget", { chars: textBudget(segment.text).graphemes })}
                      <Show when={textBudget(segment.text).bytes > 2000}>
                        {" "}
                        · {t("review.budgetBytes", { bytes: textBudget(segment.text).bytes })}
                      </Show>
                    </p>
                    <Show when={!textBudget(segment.text).valid}>
                      <span class="field-error" id={`segment-text-error-${segment.id}`}>
                        {t("review.textInvalid")}
                      </span>
                    </Show>
                    <p class="segment-tone-summary">
                      {t("review.toneSummary", {
                        tone: segment.suggestedToneHint || t("review.defaultTone"),
                      })}
                      <Show when={segment.spokenText !== undefined}>
                        {" "}
                        · {t("review.hasSpoken")}
                      </Show>
                    </p>
                    <Show
                      when={
                        textBudget(segment.text).graphemes > 400 ||
                        textBudget(segment.text).bytes > 2000
                      }
                    >
                      <div class="split-suggestion">
                        <p>{t("review.splitSuggestion")}</p>
                        <Show when={segment.spokenText !== undefined}>
                          <p>{t("review.splitSpokenWarning")}</p>
                        </Show>
                        <Button
                          variant="secondary"
                          size="compact"
                          disabled={!canAdd() || composing()}
                          onClick={() => autoSplit(index())}
                        >
                          {t("review.autoSplit")}
                        </Button>
                      </div>
                    </Show>
                    <div class="segment-compact-actions">
                      <SpeechPreview
                        requestRevision={props.requestRevision}
                        text={speechText(segment)}
                        toneHint={segment.suggestedToneHint}
                        genreHint={props.genreHint}
                        voice={props.voice}
                      />
                      <Button
                        variant="ghost"
                        size="compact"
                        aria-expanded={expanded() === segment.id}
                        aria-controls={`segment-more-${segment.id}`}
                        disabled={composing()}
                        onClick={() =>
                          setExpanded(expanded() === segment.id ? undefined : segment.id)
                        }
                      >
                        {t(expanded() === segment.id ? "review.lessEditing" : "review.moreEditing")}
                      </Button>
                    </div>
                    <Show when={expanded() === segment.id}>
                      <div class="segment-more" id={`segment-more-${segment.id}`}>
                        <label for={`segment-tone-${segment.id}`}>{t("review.tone")}</label>
                        <input
                          id={`segment-tone-${segment.id}`}
                          type="text"
                          value={segment.suggestedToneHint}
                          placeholder={t("review.tonePlaceholder")}
                          {...inputEvents(index, "suggestedToneHint")}
                        />
                        <Show
                          when={segment.spokenText !== undefined}
                          fallback={
                            <Button
                              variant="secondary"
                              size="compact"
                              class="spoken-toggle"
                              onClick={() => editSpokenText(index(), segment.text)}
                            >
                              {t("review.addSpoken")}
                            </Button>
                          }
                        >
                          <div class="spoken-correction">
                            <label for={`segment-spoken-${segment.id}`}>{t("review.spoken")}</label>
                            <textarea
                              id={`segment-spoken-${segment.id}`}
                              rows="3"
                              value={segment.spokenText ?? ""}
                              classList={{ invalid: !textBudget(speechText(segment)).valid }}
                              aria-invalid={!textBudget(speechText(segment)).valid}
                              aria-describedby={`segment-spoken-help-${segment.id}`}
                              {...inputEvents(index, "spokenText")}
                            />
                            <p class="text-budget" id={`segment-spoken-help-${segment.id}`}>
                              <Show
                                when={textBudget(speechText(segment)).valid}
                                fallback={
                                  <span class="field-error">{t("review.spokenInvalid")}</span>
                                }
                              >
                                {t("review.spokenHelp", {
                                  chars: textBudget(speechText(segment)).graphemes,
                                })}
                              </Show>
                            </p>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => editSpokenText(index(), undefined)}
                            >
                              {t("review.removeSpoken")}
                            </Button>
                          </div>
                        </Show>
                        <Show when={segment.spokenText !== undefined}>
                          <p class="settings-note">{t("review.splitSpokenWarning")}</p>
                        </Show>
                        <div class="segment-actions">
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={composing() || !segment.text.trim() || !canAdd()}
                            aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                            onClick={() => autoSplit(index())}
                          >
                            {t("review.autoSplit")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={composing() || !canAdd()}
                            aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                            onClick={() => split(index(), editor)}
                          >
                            {t("review.splitAtCursor")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={composing() || !canAdd()}
                            aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                            onClick={() => {
                              const origin = focusSnapshot(segment.id);
                              const next = insertAfter(workspace.segments, index());
                              const inserted = next[index() + 1];
                              if (!replaceSegments(next)) return;
                              props.onToast(t("review.inserted"), undoAction(origin));
                              focusSegment(inserted?.id);
                            }}
                          >
                            {t("review.insertBelow")}
                          </Button>
                          <Show when={index() < workspace.segments.length - 1}>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => {
                                const origin = focusSnapshot(segment.id);
                                if (!replaceSegments(mergeWithNext(workspace.segments, index())))
                                  return;
                                props.onToast(t("review.merged"), undoAction(origin));
                                focusSegment(segment.id);
                              }}
                            >
                              {t("review.mergeNext")}
                            </Button>
                          </Show>
                          <Button
                            variant="danger"
                            size="compact"
                            onClick={() => {
                              const number = index() + 1;
                              const origin = focusSnapshot(segment.id);
                              if (!replaceSegments(removeSegment(workspace.segments, index())))
                                return;
                              setExpanded(undefined);
                              props.onToast(
                                t("review.deletedNumber", { n: number }),
                                undoAction(origin),
                              );
                              focusSegment(undefined, "text", number - 1);
                            }}
                            aria-label={t("review.deleteLabel", { n: index() + 1 })}
                          >
                            {t("review.delete")}
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </Show>
      </div>
      <Sheet
        open={navigationOpen()}
        title={t("review.segmentList")}
        closeLabel={t("review.closeList")}
        fallbackFocus={() => heading}
        onClose={() => {
          setNavigationOpen(false);
          if (pendingJump) {
            const id = pendingJump;
            pendingJump = undefined;
            focusSegment(id);
          }
        }}
      >
        {segmentNavigation()}
      </Sheet>
      <Show when={imageUrl()}>
        <Sheet
          open={imageOpen()}
          title={t("review.compare")}
          closeLabel={t("review.closeImage")}
          fallbackFocus={() => heading}
          onClose={() => setImageOpen(false)}
        >
          <Show when={imageOpen() && imageUrl()}>{(url) => <ReviewImage url={url()} />}</Show>
        </Sheet>
      </Show>
      <div ref={footer} class="review-footer">
        <Button
          class="review-primary"
          wide
          disabled={composing() || workspace.segments.length === 0}
          onClick={() => (firstIssue() >= 0 ? focusIssue() : props.onStartPlayback())}
        >
          {firstIssue() >= 0
            ? t("review.fixSegment", { n: firstIssue() + 1 })
            : t("review.enterPlayback", { n: workspace.segments.length })}
        </Button>
      </div>
    </section>
  );
}
