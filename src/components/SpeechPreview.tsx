import { createEffect, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { requestSpeech } from "~/lib/speech";
import type { StatusReporter } from "~/lib/status";

type SpeechPreviewProps = {
  text: string;
  toneHint: string;
  genreHint?: string;
  onStatus: StatusReporter;
};

export default function SpeechPreview(props: SpeechPreviewProps) {
  const [busy, setBusy] = createSignal(false);
  const [audioUrl, setAudioUrl] = createSignal<string>();
  const [duration, setDuration] = createSignal<number>();

  function captionsUrl() {
    const transcript = props.text.replaceAll("-->", "→");
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${transcript}`)}`;
  }

  function clearAudio() {
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
    setAudioUrl(undefined);
    setDuration(undefined);
  }

  createEffect(
    on(
      () => [props.text, props.toneHint, props.genreHint],
      () => clearAudio(),
      { defer: true },
    ),
  );
  onCleanup(() => {
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
  });

  async function generate() {
    if (!props.text.trim()) {
      props.onStatus("請先填寫段落文字", "error");
      return;
    }
    clearAudio();
    setBusy(true);
    props.onStatus("Gemini 正在產生試聽音訊…");
    try {
      const audio = await requestSpeech({
        text: props.text,
        toneHint: props.toneHint || undefined,
        genreHint: props.genreHint || undefined,
      });
      setAudioUrl(URL.createObjectURL(audio.blob));
      setDuration(audio.durationMs);
      props.onStatus("試聽已準備完成，請按播放", "success");
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : "無法產生試聽", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="speech-preview">
      <button
        type="button"
        class="small preview-button"
        disabled={busy() || !props.text.trim()}
        onClick={generate}
      >
        {busy() ? "產生中…" : "產生試聽"}
      </button>
      <Show when={audioUrl()}>
        {(url) => (
          <div class="audio-result">
            <audio controls preload="metadata" src={url()} aria-label="段落試聽">
              <track kind="captions" src={captionsUrl()} label="口白文字" default />
            </audio>
            <Show when={duration()}>
              {(durationMs) => <span>{(durationMs() / 1000).toFixed(1)} 秒</span>}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
