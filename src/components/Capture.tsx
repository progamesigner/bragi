import { createSignal, onCleanup, Show } from "solid-js";
import { type PreparedImage, prepareImage } from "~/lib/image";
import type { StatusReporter } from "~/lib/status";
import { type Operation, WorkspaceRevision } from "~/lib/workspace";

type CaptureProps = {
  disabled: boolean;
  onChange: (image: PreparedImage) => void;
  onSelect: () => Operation;
  onCancel: () => void;
  onStatus: StatusReporter;
};

export default function Capture(props: CaptureProps) {
  const [image, setImage] = createSignal<PreparedImage>();
  const [sourceFile, setSourceFile] = createSignal<File>();
  const [preparationFailed, setPreparationFailed] = createSignal(false);
  const [previewUrl, setPreviewUrl] = createSignal<string>();
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [preparing, setPreparing] = createSignal(false);
  const operations = new WorkspaceRevision();

  const selectedImage = (): PreparedImage | undefined => {
    const file = sourceFile();
    return image() ?? (file ? { file, transformed: false } : undefined);
  };

  function replacePreview(url?: string) {
    const previous = previewUrl();
    if (previous) URL.revokeObjectURL(previous);
    setPreviewUrl(url);
    setPreviewFailed(false);
  }

  onCleanup(() => {
    operations.invalidate();
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
  });

  async function selectFile(file?: File) {
    if (!file) return;
    const operation = operations.begin();
    const workspaceOperation = props.onSelect();
    const current = () => operation.current() && workspaceOperation.current();
    setPreparing(true);
    setSourceFile(file);
    setPreparationFailed(false);
    setImage(undefined);
    replacePreview(URL.createObjectURL(file));
    props.onStatus("正在調整方向與圖片大小…");
    try {
      const prepared = await prepareImage(file);
      if (!current()) return;
      setImage(prepared);
      replacePreview(URL.createObjectURL(prepared.file));
      props.onChange(prepared);
      props.onStatus(
        prepared.warning ?? "圖片已準備完成，可以開始辨識",
        prepared.warning ? "info" : "success",
      );
    } catch (error) {
      if (!current()) return;
      setPreparationFailed(true);
      props.onStatus(error instanceof Error ? error.message : "無法處理圖片", "error");
    } finally {
      if (operation.current()) setPreparing(false);
    }
  }

  function inputChanged(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    void selectFile(input.files?.[0]);
    input.value = "";
  }

  return (
    <div class="capture">
      <div class="capture-actions">
        <label class="file-button" for="camera-input" aria-disabled={props.disabled || preparing()}>
          拍照
        </label>
        <input
          id="camera-input"
          class="visually-hidden"
          type="file"
          accept="image/*,.heic,.heif"
          capture="environment"
          aria-describedby="upload-privacy"
          disabled={props.disabled || preparing()}
          onChange={inputChanged}
        />
        <label
          class="file-button secondary"
          for="library-input"
          aria-disabled={props.disabled || preparing()}
        >
          從相簿選擇
        </label>
        <input
          id="library-input"
          class="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          aria-describedby="upload-privacy"
          disabled={props.disabled || preparing()}
          onChange={inputChanged}
        />
      </div>

      <Show when={sourceFile()}>
        <button
          type="button"
          class="small secondary"
          onClick={() => {
            operations.invalidate();
            setPreparing(false);
            setSourceFile(undefined);
            setPreparationFailed(false);
            setImage(undefined);
            replacePreview();
            props.onCancel();
          }}
        >
          取消候選圖片
        </button>
      </Show>

      <Show when={preparationFailed()}>
        <button type="button" class="small secondary" onClick={() => void selectFile(sourceFile())}>
          重試圖片處理
        </button>
      </Show>

      <Show when={selectedImage()}>
        {(selected) => (
          <div class="capture-preview">
            <Show when={previewUrl() && !previewFailed()}>
              <img
                src={previewUrl()}
                alt="準備上傳的圖片預覽"
                onError={() => setPreviewFailed(true)}
              />
            </Show>
            <Show when={previewFailed()}>
              <div class="preview-placeholder">此瀏覽器無法顯示圖片預覽</div>
            </Show>
            <p class="file">
              {selected().file.name} · {(selected().file.size / 1_000_000).toFixed(2)} MB
              <Show when={selected().width && selected().height}>
                {` · ${selected().width} × ${selected().height}`}
              </Show>
            </p>
            <Show when={selected().transformed}>
              <p class="image-note">已套用照片方向並壓縮為適合上傳的 JPEG</p>
            </Show>
            <Show when={selected().warning}>
              {(warning) => <p class="image-warning">{warning()}</p>}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
