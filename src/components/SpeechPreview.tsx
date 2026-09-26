import { createEffect, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { textBudget } from "~/lib/editing";
import { networkErrorMessage } from "~/lib/network";
import { requestCachedSpeech } from "~/lib/speech-cache";
import type { StatusReporter } from "~/lib/status";

type SpeechPreviewProps = {
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
      () => [props.text, props.toneHint, props.genreHint, props.voice],
      () => {
        request?.abort();
        clearAudio();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    request?.abort();
    audioElement?.pause();
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
  });

  async function generate() {
    if (!textBudget(props.text).valid) {
      props.onStatus("請先填寫符合長度限制的段落文字", "error");
      return;
    }
    clearAudio();
    request?.abort();
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    props.onStatus("Gemini 正在產生試聽音訊…");
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
      props.onStatus("試聽已準備完成，請按播放", "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      props.onStatus(networkErrorMessage(error, "無法產生試聽"), "error");
    } finally {
      if (request === controller) setBusy(false);
    }
  }

  return (
    <div class="speech-preview">
      <button
        type="button"
        class="small preview-button"
        disabled={busy() || !textBudget(props.text).valid}
        onClick={generate}
      >
        {busy() ? "產生中…" : "產生試聽"}
      </button>
      <Show when={audioUrl()}>
        {(url) => (
          <div class="audio-result">
            <audio ref={audioElement} controls preload="metadata" src={url()} aria-label="段落試聽">
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
