import { For, Show } from "solid-js";
import { reconcile, type SetStoreFunction } from "solid-js/store";
import {
  insertAfter,
  mergeWithNext,
  removeSegment,
  type Segment,
  splitAtCursor,
} from "~/lib/state";

type ReviewProps = {
  detectedLanguage: string;
  segments: Segment[];
  setSegments: SetStoreFunction<Segment[]>;
  onStatus: (message: string) => void;
};

export default function Review(props: ReviewProps) {
  function replaceSegments(segments: Segment[]) {
    props.setSegments(reconcile(segments));
  }

  function split(index: number, editor: HTMLTextAreaElement) {
    try {
      replaceSegments(splitAtCursor(props.segments, index, editor.selectionStart));
      props.onStatus("段落已分割");
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : "無法分割段落");
      editor.focus();
    }
  }

  return (
    <section class="card review" aria-labelledby="review-heading">
      <div class="review-heading">
        <div>
          <h2 id="review-heading">3. 校對辨識草稿</h2>
          <p>
            主要語言：{props.detectedLanguage} · {props.segments.length} 個段落
          </p>
        </div>
        <button
          type="button"
          class="small secondary"
          onClick={() => replaceSegments(insertAfter(props.segments, props.segments.length - 1))}
        >
          新增段落
        </button>
      </div>

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
                    classList={{ invalid: segment.text.trim().length === 0 }}
                    aria-invalid={segment.text.trim().length === 0}
                    onInput={(event) =>
                      props.setSegments(index(), "text", event.currentTarget.value)
                    }
                  />
                  <label for={`segment-tone-${segment.id}`}>朗讀語氣</label>
                  <input
                    id={`segment-tone-${segment.id}`}
                    type="text"
                    maxlength="120"
                    value={segment.suggestedToneHint}
                    placeholder="例如：低沉、急促、帶有期待感"
                    onInput={(event) =>
                      props.setSegments(index(), "suggestedToneHint", event.currentTarget.value)
                    }
                  />
                  <div class="segment-actions">
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
                        props.onStatus("已新增空白段落");
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
                          props.onStatus("已與下一段合併");
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
                        props.onStatus("段落已刪除");
                      }}
                      aria-label={`刪除段落 ${index() + 1}`}
                    >
                      刪除
                    </button>
                  </div>
                </li>
              );
            }}
          </For>
        </ol>
      </Show>
    </section>
  );
}
