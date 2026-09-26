import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { reconcile, type SetStoreFunction } from "solid-js/store";
import { draftFileName, serializeDraft } from "~/lib/draft";
import { type History, splitNarration, textBudget } from "~/lib/editing";
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
import SpeechPreview from "./SpeechPreview";

type ReviewProps = {
  detectedLanguage: string;
  image?: File;
  genreHint?: string;
  voice?: string;
  segments: Segment[];
  history: History<Segment[]>;
  setSegments: SetStoreFunction<Segment[]>;
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
  const history = () => props.history;
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const canUndo = () => {
    historyVersion();
    return history().canUndo;
  };
  const canRedo = () => {
    historyVersion();
    return history().canRedo;
  };
  const restore = (redo = false) => {
    props.setSegments(reconcile(redo ? history().redo() : history().undo()));
    setHistoryVersion((v) => v + 1);
  };
  const canStartPlayback = () =>
    props.segments.length > 0 &&
    props.segments.every(
      (segment) => textBudget(segment.text).valid && textBudget(speechText(segment)).valid,
    );

  onMount(() => heading.focus());

  function replaceSegments(segments: Segment[], group?: string) {
    history().commit(segments, group);
    setHistoryVersion((v) => v + 1);
    props.setSegments(reconcile(segments));
  }

  function edit(index: number, field: "text" | "suggestedToneHint", value: string) {
    replaceSegments(
      props.segments.map((segment, position) =>
        position === index ? { ...segment, [field]: value } : { ...segment },
      ),
      `${props.segments[index]?.id}:${field}`,
    );
  }
  function editSpokenText(index: number, value: string | undefined) {
    replaceSegments(
      props.segments.map((segment, position) =>
        position === index ? withSpokenText(segment, value) : { ...segment },
      ),
      value === undefined ? undefined : `${props.segments[index]?.id}:spokenText`,
    );
  }
  function autoSplit(index: number) {
    const segment = props.segments[index];
    if (!segment) return;
    try {
      const parts = splitNarration(segment.text);
      if (parts.length < 2) {
        props.onStatus("這個段落已符合朗讀限制");
        return;
      }
      replaceSegments([
        ...props.segments.slice(0, index),
        ...parts.map((text, i) =>
          withSpokenText(
            { ...segment, id: i === 0 ? segment.id : `segment-${crypto.randomUUID()}`, text },
            undefined,
          ),
        ),
        ...props.segments.slice(index + 1),
      ]);
      props.onStatus(
        `已分成 ${parts.length} 個可朗讀段落${spokenCorrectionNotice(segment)}`,
        "success",
      );
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : "無法自動分段", "error");
    }
  }
  function exportDraft() {
    const blob = new Blob(
      [
        serializeDraft({
          detectedLanguage: props.detectedLanguage,
          genreHint: props.genreHint,
          segments: props.segments,
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
    props.onStatus("已匯出草稿 JSON；檔案只含文字，不含圖片或音訊", "success");
  }
  function spokenCorrectionNotice(segment: Segment) {
    return segment.spokenText === undefined ? "" : "；原本的朗讀修正已移除，請依新段落重新設定";
  }
  function split(index: number, editor: HTMLTextAreaElement) {
    const segment = props.segments[index];
    try {
      replaceSegments(splitAtCursor(props.segments, index, editor.selectionStart));
      props.onStatus(`段落已分割${segment ? spokenCorrectionNotice(segment) : ""}`, "success");
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : "無法分割段落", "error");
      editor.focus();
    }
  }

  return (
    <section class="card review" aria-labelledby="review-heading">
      <div class="review-heading">
        <div>
          <h2 ref={heading} id="review-heading" tabindex="-1">
            3. 校對辨識草稿
          </h2>
          <p>
            主要語言：{props.detectedLanguage} · {props.segments.length} 個段落
          </p>
        </div>
        <div class="review-heading-actions">
          <button
            type="button"
            class="small secondary"
            disabled={!canUndo()}
            onClick={() => restore()}
          >
            復原
          </button>
          <button
            type="button"
            class="small secondary"
            disabled={!canRedo()}
            onClick={() => restore(true)}
          >
            重做
          </button>
          <button
            type="button"
            class="small secondary"
            onClick={() => replaceSegments(insertAfter(props.segments, props.segments.length - 1))}
          >
            新增段落
          </button>
          <button type="button" class="small secondary" onClick={exportDraft}>
            匯出草稿
          </button>
          <button
            type="button"
            class="small"
            disabled={!canStartPlayback()}
            onClick={props.onStartPlayback}
          >
            開始逐段朗讀
          </button>
        </div>
      </div>

      <Show when={imageUrl()}>
        {(url) => (
          <details class="image-comparison">
            <summary>查看圖片對照</summary>
            <label for="comparison-zoom">圖片放大</label>
            <select
              id="comparison-zoom"
              value={zoom()}
              onChange={(event) => setZoom(event.currentTarget.value)}
            >
              <option value="1">符合寬度</option>
              <option value="1.5">1.5 倍</option>
              <option value="2">2 倍</option>
              <option value="3">3 倍</option>
            </select>
            <Show
              when={!imageFailed()}
              fallback={<p>此裝置無法預覽這個圖片格式，請使用原始照片校對。</p>}
            >
              <section
                style={{ overflow: "auto", "max-height": "60vh" }}
                tabindex="0"
                aria-label="圖片對照，可捲動查看"
              >
                <img
                  src={url()}
                  alt="校對用圖片"
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
        when={props.segments.length > 0}
        fallback={<p class="empty-state">目前沒有段落。新增一段，或重新辨識圖片。</p>}
      >
        <ol class="review-segments">
          <For each={props.segments}>
            {(segment, index) => {
              let editor!: HTMLTextAreaElement;
              return (
                <li class="review-segment">
                  <div class="segment-number">段落 {index() + 1}</div>
                  <label for={`segment-text-${segment.id}`}>口白文字</label>
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
                    onInput={(event) => edit(index(), "text", event.currentTarget.value)}
                  />
                  <p class="text-budget">
                    {textBudget(segment.text).graphemes} / 400 字 · {textBudget(segment.text).bytes}{" "}
                    / 2,000 位元組
                  </p>
                  <Show when={!textBudget(segment.text).valid}>
                    <span class="field-error" id={`segment-text-error-${segment.id}`}>
                      請輸入可朗讀文字；超過 400 字或 2,000 位元組時請分段
                    </span>
                  </Show>
                  <label for={`segment-tone-${segment.id}`}>朗讀語氣</label>
                  <input
                    id={`segment-tone-${segment.id}`}
                    type="text"
                    maxlength="120"
                    value={segment.suggestedToneHint}
                    placeholder="例如：低沉、急促、帶有期待感"
                    onInput={(event) =>
                      edit(index(), "suggestedToneHint", event.currentTarget.value)
                    }
                  />
                  <Show
                    when={segment.spokenText !== undefined}
                    fallback={
                      <button
                        type="button"
                        class="small secondary spoken-toggle"
                        onClick={() => editSpokenText(index(), segment.text)}
                      >
                        另設朗讀文字
                      </button>
                    }
                  >
                    <div class="spoken-correction">
                      <label for={`segment-spoken-${segment.id}`}>朗讀文字（只影響語音）</label>
                      <textarea
                        id={`segment-spoken-${segment.id}`}
                        rows="3"
                        value={segment.spokenText ?? ""}
                        classList={{ invalid: !textBudget(speechText(segment)).valid }}
                        aria-invalid={!textBudget(speechText(segment)).valid}
                        aria-describedby={`segment-spoken-help-${segment.id}`}
                        onInput={(event) => editSpokenText(index(), event.currentTarget.value)}
                      />
                      <p class="text-budget" id={`segment-spoken-help-${segment.id}`}>
                        <Show
                          when={textBudget(speechText(segment)).valid}
                          fallback={
                            <span class="field-error">
                              請輸入可朗讀文字；超過 400 字或 2,000 位元組時請縮短
                            </span>
                          }
                        >
                          畫面仍顯示口白文字，語音改念這段 ·{" "}
                          {textBudget(speechText(segment)).graphemes} / 400 字
                        </Show>
                      </p>
                      <button
                        type="button"
                        class="small secondary"
                        onClick={() => editSpokenText(index(), undefined)}
                      >
                        改回朗讀口白文字
                      </button>
                    </div>
                  </Show>
                  <div class="segment-actions">
                    <button
                      type="button"
                      class="small secondary"
                      disabled={!segment.text.trim()}
                      onClick={() => autoSplit(index())}
                    >
                      按句自動分段
                    </button>
                    <button
                      type="button"
                      class="small secondary"
                      onClick={() => split(index(), editor)}
                    >
                      從游標分割
                    </button>
                    <button
                      type="button"
                      class="small secondary"
                      onClick={() => {
                        replaceSegments(insertAfter(props.segments, index()));
                        props.onStatus("已新增空白段落", "success");
                      }}
                    >
                      在下方新增
                    </button>
                    <Show when={index() < props.segments.length - 1}>
                      <button
                        type="button"
                        class="small secondary"
                        onClick={() => {
                          replaceSegments(mergeWithNext(props.segments, index()));
                          props.onStatus("已與下一段合併", "success");
                        }}
                      >
                        合併下一段
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="small danger"
                      onClick={() => {
                        replaceSegments(removeSegment(props.segments, index()));
                        props.onStatus("段落已刪除", "success");
                      }}
                      aria-label={`刪除段落 ${index() + 1}`}
                    >
                      刪除
                    </button>
                  </div>
                  <SpeechPreview
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
