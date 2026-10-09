import { createEffect, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { textBudget } from "~/lib/editing";
import { t } from "~/lib/i18n";
import { requestCachedSpeech } from "~/lib/speech-cache";
import { reportError, type StatusReporter } from "~/lib/status";
import Button from "./ui/Button";

type SpeechPreviewProps = {
  requestRevision?: object;
  text: string;
  toneHint: string;
  genreHint?: string;
  voice?: string;
  onStatus: StatusReporter;
};

export default function SpeechPreview(props: SpeechPreviewProps) {
  const [busy, setBusy] = createSignal(false);
  const [audioUrl, setAudioUrl] = createSignal<string>();
  const [duration, setDuration] = createSignal<number>();
  let request: AbortController | undefined;
  let audioElement: HTMLAudioElement | undefined;

  function captionsUrl() {
    const transcript = props.text.replaceAll("-->", "→");
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${transcript}`)}`;
  }

  function clearAudio() {
    audioElement?.pause();
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
    setAudioUrl(undefined);
    setDuration(undefined);
  }

  createEffect(
    on(
      () => [props.text, props.toneHint, props.genreHint, props.voice, props.requestRevision],
      () => {
        request?.abort();
        request = undefined;
        setBusy(false);
        clearAudio();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    request?.abort();
    request = undefined;
    audioElement?.pause();
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
  });

  async function generate() {
    if (!textBudget(props.text).valid) {
      props.onStatus(t("preview.invalid"), "error");
      return;
    }
    clearAudio();
    request?.abort();
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    props.onStatus(t("preview.generating"));
    try {
      const audio = await requestCachedSpeech(
        {
          text: props.text,
          voice: props.voice,
          toneHint: props.toneHint || undefined,
          genreHint: props.genreHint || undefined,
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setAudioUrl(URL.createObjectURL(audio.blob));
      setDuration(audio.durationMs);
      props.onStatus(t("preview.ready"), "success");
    } catch (error) {
      if (request !== controller || controller.signal.aborted) return;
      reportError(props.onStatus, error, t("preview.failed"));
    } finally {
      if (request === controller && !controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div class="speech-preview">
      <Button
        variant="secondary"
        size="compact"
        wide
        disabled={busy() || !textBudget(props.text).valid}
        onClick={generate}
      >
        {busy() ? t("common.generating") : t("preview.generate")}
      </Button>
      <Show when={audioUrl()}>
        {(url) => (
          <div class="audio-result">
            <audio
              ref={audioElement}
              controls
              preload="metadata"
              src={url()}
              aria-label={t("preview.audio")}
            >
              <track kind="captions" src={captionsUrl()} label={t("audio.captions")} default />
            </audio>
            <Show when={duration()}>
              {(durationMs) => (
                <span>{t("common.seconds", { s: (durationMs() / 1000).toFixed(1) })}</span>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
