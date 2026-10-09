import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "~/lib/i18n";
import { type PreparedImage, prepareImage } from "~/lib/image";
import type { StatusReporter } from "~/lib/status";
import { type Operation, WorkspaceRevision } from "~/lib/workspace";
import Button, { buttonClass } from "./ui/Button";

type CaptureProps = {
  disabled: boolean;
  /** A candidate prepared earlier, shown again when the person comes back to this screen. */
  initial?: PreparedImage;
  onChange: (image: PreparedImage) => void;
  onSelect: () => Operation;
  onCancel: () => void;
  onStatus: StatusReporter;
};

export default function Capture(props: CaptureProps) {
  const [image, setImage] = createSignal<PreparedImage | undefined>(props.initial);
  const [sourceFile, setSourceFile] = createSignal<File | undefined>(props.initial?.file);
  const [preparationFailed, setPreparationFailed] = createSignal(false);
  const [previewUrl, setPreviewUrl] = createSignal<string | undefined>(
    props.initial ? URL.createObjectURL(props.initial.file) : undefined,
  );
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
    props.onStatus(t("capture.preparing"));
    try {
      const prepared = await prepareImage(file);
      if (!current()) return;
      setImage(prepared);
      replacePreview(URL.createObjectURL(prepared.file));
      props.onChange(prepared);
      props.onStatus(prepared.warning ?? t("capture.ready"), prepared.warning ? "info" : "success");
    } catch (error) {
      if (!current()) return;
      setPreparationFailed(true);
      props.onStatus(error instanceof Error ? error.message : t("capture.failed"), "error");
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
        <label
          class={`${buttonClass("primary")} file-button`}
          for="camera-input"
          aria-disabled={props.disabled || preparing()}
        >
          {t("capture.camera")}
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
          class={`${buttonClass("secondary")} file-button`}
          for="library-input"
          aria-disabled={props.disabled || preparing()}
        >
          {t("capture.library")}
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
        <Button
          variant="secondary"
          size="compact"
          class="capture-secondary"
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
          {t("capture.cancelCandidate")}
        </Button>
      </Show>

      <Show when={preparationFailed()}>
        <Button
          variant="secondary"
          size="compact"
          class="capture-secondary"
          onClick={() => void selectFile(sourceFile())}
        >
          {t("capture.retryPrepare")}
        </Button>
      </Show>

      <Show when={selectedImage()}>
        {(selected) => (
          <div class="capture-preview">
            <Show when={previewUrl() && !previewFailed()}>
              <img
                src={previewUrl()}
                alt={t("capture.previewAlt")}
                onError={() => setPreviewFailed(true)}
              />
            </Show>
            <Show when={previewFailed()}>
              <div class="preview-placeholder">{t("capture.previewUnavailable")}</div>
            </Show>
            <p class="file">
              {selected().file.name} · {(selected().file.size / 1_000_000).toFixed(2)} MB
              <Show when={selected().width && selected().height}>
                {` · ${selected().width} × ${selected().height}`}
              </Show>
            </p>
            <Show when={selected().transformed}>
              <p class="image-note">{t("capture.transformed")}</p>
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
