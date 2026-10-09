import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { draftFileName, serializeDraft } from "~/lib/draft";
import { MAX_DRAFT_SEGMENTS } from "~/lib/draft-limits";
import { splitNarration, textBudget } from "~/lib/editing";
import { t } from "~/lib/i18n";
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
import SpeechPreview from "./SpeechPreview";
import Button from "./ui/Button";
import Select from "./ui/Select";

type ReviewProps = {
  requestRevision?: object;
  detectedLanguage: string;
  image?: File;
  genreHint?: string;
  voice?: string;
  onStartPlayback: () => void;
  onStatus: StatusReporter;
};

export default function Review(props: ReviewProps) {
  const [imageUrl, setImageUrl] = createSignal<string>();
  const [zoom, setZoom] = createSignal("1");
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(() => {
    const file = props.image;
    setImageFailed(false);
    setZoom("1");
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
    try {
      if (redo) workspace.redo();
      else workspace.undo();
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.restoreFailed"), "error");
    }
  };
  const canStartPlayback = () =>
    workspace.segments.length > 0 &&
    workspace.segments.every(
      (segment) => textBudget(segment.text).valid && textBudget(speechText(segment)).valid,
    );

  onMount(() => heading.focus());

  function replaceSegments(segments: Segment[], group?: string) {
    try {
      workspace.edit(segments, group);
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
    try {
      const parts = splitNarration(segment.text);
      if (parts.length < 2) {
        props.onStatus(t("review.alreadyShort"));
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
      props.onStatus(
        `${t("review.autoSplitDone", { n: parts.length })}${spokenCorrectionNotice(segment)}`,
        "success",
      );
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.autoSplitFailed"), "error");
    }
  }
  function exportDraft() {
    try {
      const blob = new Blob(
        [
          serializeDraft({
            detectedLanguage: props.detectedLanguage,
            genreHint: props.genreHint,
            segments: workspace.segments,
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
      props.onStatus(t("draft.exported"), "success");
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("draft.exportFailed"), "error");
    }
  }
  function spokenCorrectionNotice(segment: Segment) {
    return segment.spokenText === undefined ? "" : t("review.spokenReset");
  }
  function split(index: number, editor: HTMLTextAreaElement) {
    const segment = workspace.segments[index];
    try {
      if (!replaceSegments(splitAtCursor(workspace.segments, index, editor.selectionStart))) return;
      props.onStatus(
        `${t("review.splitDone")}${segment ? spokenCorrectionNotice(segment) : ""}`,
        "success",
      );
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : t("review.splitFailed"), "error");
      editor.focus();
    }
  }

  return (
    <section class="card review" aria-labelledby="review-heading">
      <div class="review-heading">
        <div>
          <h2 ref={heading} id="review-heading" tabindex="-1">
            {t("review.heading")}
          </h2>
          <p>
            {t("review.summary", {
              language: props.detectedLanguage,
              n: workspace.segments.length,
            })}
          </p>
        </div>
        <div class="review-heading-actions">
          <Button
            variant="secondary"
            size="compact"
            disabled={!workspace.canUndo()}
            onClick={() => restore()}
          >
            {t("review.undo")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={!workspace.canRedo()}
            onClick={() => restore(true)}
          >
            {t("review.redo")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={!canAdd()}
            aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
            onClick={() =>
              replaceSegments(insertAfter(workspace.segments, workspace.segments.length - 1))
            }
          >
            {t("review.addSegment")}
          </Button>
          <Button variant="secondary" size="compact" onClick={exportDraft}>
            {t("review.export")}
          </Button>
          <Button disabled={!canStartPlayback()} onClick={props.onStartPlayback}>
            {t("review.startPlayback")}
          </Button>
        </div>
      </div>

      <Show when={!canAdd()}>
        <p id="draft-limit-note" class="field-error">
          {t("review.limitReached")}
        </p>
      </Show>

      <Show when={imageUrl()}>
        {(url) => (
          <details class="image-comparison">
            <summary>{t("review.compare")}</summary>
            <label for="comparison-zoom">{t("review.zoom")}</label>
            <Select
              id="comparison-zoom"
              value={zoom()}
              onChange={(event) => setZoom(event.currentTarget.value)}
            >
              <option value="1">{t("review.zoomFit")}</option>
              <option value="1.5">{t("review.zoomTimes", { n: 1.5 })}</option>
              <option value="2">{t("review.zoomTimes", { n: 2 })}</option>
              <option value="3">{t("review.zoomTimes", { n: 3 })}</option>
            </Select>
            <Show when={!imageFailed()} fallback={<p>{t("review.imageUnsupported")}</p>}>
              <section
                style={{ overflow: "auto", "max-height": "60vh" }}
                tabindex="0"
                aria-label={t("review.imageScroller")}
              >
                <img
                  src={url()}
                  alt={t("review.imageAlt")}
                  style={{
                    width: `${Number(zoom()) * 100}%`,
                    "max-width": "none",
                    display: "block",
                  }}
                  onError={() => setImageFailed(true)}
                />
              </section>
            </Show>
          </details>
        )}
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
                <li class="review-segment">
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
                    onInput={(event) => {
                      if (!edit(index(), "text", event.currentTarget.value))
                        event.currentTarget.value = segment.text;
                    }}
                  />
                  <p class="text-budget">
                    {t("review.budget", {
                      chars: textBudget(segment.text).graphemes,
                      bytes: textBudget(segment.text).bytes,
                    })}
                  </p>
                  <Show when={!textBudget(segment.text).valid}>
                    <span class="field-error" id={`segment-text-error-${segment.id}`}>
                      {t("review.textInvalid")}
                    </span>
                  </Show>
                  <label for={`segment-tone-${segment.id}`}>{t("review.tone")}</label>
                  <input
                    id={`segment-tone-${segment.id}`}
                    type="text"
                    value={segment.suggestedToneHint}
                    placeholder={t("review.tonePlaceholder")}
                    onInput={(event) => {
                      if (!edit(index(), "suggestedToneHint", event.currentTarget.value))
                        event.currentTarget.value = segment.suggestedToneHint;
                    }}
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
                        onInput={(event) => {
                          if (!editSpokenText(index(), event.currentTarget.value))
                            event.currentTarget.value = segment.spokenText ?? "";
                        }}
                      />
                      <p class="text-budget" id={`segment-spoken-help-${segment.id}`}>
                        <Show
                          when={textBudget(speechText(segment)).valid}
                          fallback={<span class="field-error">{t("review.spokenInvalid")}</span>}
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
                  <div class="segment-actions">
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!segment.text.trim() || !canAdd()}
                      aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                      onClick={() => autoSplit(index())}
                    >
                      {t("review.autoSplit")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!canAdd()}
                      aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                      onClick={() => split(index(), editor)}
                    >
                      {t("review.splitAtCursor")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!canAdd()}
                      aria-describedby={!canAdd() ? "draft-limit-note" : undefined}
                      onClick={() => {
                        if (!replaceSegments(insertAfter(workspace.segments, index()))) return;
                        props.onStatus(t("review.inserted"), "success");
                      }}
                    >
                      {t("review.insertBelow")}
                    </Button>
                    <Show when={index() < workspace.segments.length - 1}>
                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => {
                          if (!replaceSegments(mergeWithNext(workspace.segments, index()))) return;
                          props.onStatus(t("review.merged"), "success");
                        }}
                      >
                        {t("review.mergeNext")}
                      </Button>
                    </Show>
                    <Button
                      variant="danger"
                      size="compact"
                      onClick={() => {
                        replaceSegments(removeSegment(workspace.segments, index()));
                        props.onStatus(t("review.deleted"), "success");
                      }}
                      aria-label={t("review.deleteLabel", { n: index() + 1 })}
                    >
                      {t("review.delete")}
                    </Button>
                  </div>
                  <SpeechPreview
                    requestRevision={props.requestRevision}
                    text={speechText(segment)}
                    toneHint={segment.suggestedToneHint}
                    genreHint={props.genreHint}
                    voice={props.voice}
                    onStatus={props.onStatus}
                  />
                </li>
              );
            }}
          </For>
        </ol>
      </Show>
    </section>
  );
}
