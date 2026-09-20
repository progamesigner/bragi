import { createSignal, Match, onCleanup, onMount, Show, Switch, untrack } from "solid-js";
import { initialPlaybackState, type PlaybackEvent, transitionPlayback } from "~/lib/playback";
import { requestCachedSpeech } from "~/lib/speech-cache";
import type { Segment } from "~/lib/state";
import type { StatusReporter } from "~/lib/status";

type PlaybackProps = {
  segments: Segment[];
  genreHint?: string;
  onBack: () => void;
  onStatus: StatusReporter;
};

export default function Playback(props: PlaybackProps) {
  const [state, setState] = createSignal(initialPlaybackState);
  const [audioUrl, setAudioUrl] = createSignal<string>();
  const [duration, setDuration] = createSignal<number>();
  let audio!: HTMLAudioElement;
  let heading!: HTMLHeadingElement;
  let request: AbortController | undefined;

  const segment = () => props.segments[state().index];

  function dispatch(event: PlaybackEvent) {
    setState((current) => transitionPlayback(current, event, props.segments.length));
  }

  function captionsUrl() {
    const transcript = segment()?.text.replaceAll("-->", "→") ?? "";
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${transcript}`)}`;
  }

  function clearAudio() {
    audio?.pause();
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
    setAudioUrl(undefined);
    setDuration(undefined);
  }

  async function prepare(event: "start" | "next" | "retry") {
    dispatch({ type: event });
    const nextState = state();
    if (nextState.phase !== "loading") return;

    request?.abort();
    request = new AbortController();
    clearAudio();
    props.onStatus(`正在產生第 ${nextState.index + 1} 段音訊…`);
    try {
      const current = props.segments[nextState.index];
      if (!current) throw new Error("找不到要播放的段落");
      const result = await requestCachedSpeech(
        {
          text: current.text,
          toneHint: current.suggestedToneHint || undefined,
          genreHint: props.genreHint,
        },
        request.signal,
      );
      setAudioUrl(URL.createObjectURL(result.blob));
      setDuration(result.durationMs);
      dispatch({ type: "audio-ready" });
      props.onStatus(`第 ${nextState.index + 1} 段已準備，請按播放`, "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "無法產生朗讀音訊";
      dispatch({ type: "fail", message });
      props.onStatus(message, "error");
    }
  }

  async function play() {
    if (!audioUrl()) return;
    try {
      await audio.play();
    } catch {
      props.onStatus("瀏覽器阻止播放，請再按一次播放按鈕", "error");
    }
  }

  function leavePlayback() {
    request?.abort();
    clearAudio();
    props.onBack();
  }

  onCleanup(() => {
    request?.abort();
    clearAudio();
  });
  onMount(() => heading.focus());

  return (
    <section class="card playback" aria-labelledby="playback-heading">
      <div class="playback-heading">
        <div>
          <p class="eyebrow">逐段朗讀</p>
          <h2 ref={heading} id="playback-heading" tabindex="-1">
            第 {state().index + 1} 段，共 {props.segments.length} 段
          </h2>
        </div>
        <button type="button" class="small secondary" onClick={leavePlayback}>
          返回校對
        </button>
      </div>

      <article class="playback-script" aria-live="polite">
        <p>{segment()?.text}</p>
        <Show when={segment()?.suggestedToneHint}>
          <span>語氣：{segment()?.suggestedToneHint}</span>
        </Show>
      </article>

      <Show when={audioUrl()}>
        {(url) => (
          <div class="playback-audio">
            <audio
              ref={audio}
              controls
              preload="metadata"
              src={url()}
              aria-label={`第 ${state().index + 1} 段朗讀`}
              onPlay={() => dispatch({ type: "play" })}
              onPause={() => {
                if (!audio.ended) dispatch({ type: "pause" });
              }}
              onEnded={() => {
                dispatch({ type: "ended" });
                props.onStatus(
                  state().phase === "complete" ? "全部段落播放完成" : "本段播放完成",
                  "success",
                );
              }}
            >
              <track kind="captions" src={captionsUrl()} label="口白文字" default />
            </audio>
            <Show when={duration()}>
              {(durationMs) => <span>{(durationMs() / 1000).toFixed(1)} 秒</span>}
            </Show>
          </div>
        )}
      </Show>

      <div class="playback-actions">
        <Switch>
          <Match when={state().phase === "idle"}>
            <button type="button" onClick={() => prepare("start")}>
              準備第一段
            </button>
          </Match>
          <Match when={state().phase === "loading"}>
            <button type="button" disabled>
              正在產生音訊…
            </button>
          </Match>
          <Match when={state().phase === "ready"}>
            <button type="button" onClick={play}>
              播放第 {state().index + 1} 段
            </button>
          </Match>
          <Match when={state().phase === "playing"}>
            <button type="button" onClick={() => audio.pause()}>
              暫停
            </button>
          </Match>
          <Match when={state().phase === "waiting"}>
            <button type="button" class="secondary" onClick={play}>
              重播本段
            </button>
            <button type="button" onClick={() => prepare("next")}>
              準備下一段
            </button>
          </Match>
          <Match when={state().phase === "error"}>
            <p role="alert">{state().error}</p>
            <button type="button" onClick={() => prepare("retry")}>
              重試本段
            </button>
          </Match>
          <Match when={state().phase === "complete"}>
            <p>全部段落播放完成。</p>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "reset" });
                prepare("start");
              }}
            >
              從頭播放
            </button>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
