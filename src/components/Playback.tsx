import { createSignal, Match, onCleanup, onMount, Show, Switch, untrack } from "solid-js";
import { networkErrorMessage } from "~/lib/network";
import { initialPlaybackState, type PlaybackEvent, transitionPlayback } from "~/lib/playback";
import type { SpeechRequest } from "~/lib/speech";
import { requestCachedSpeech, speechCache } from "~/lib/speech-cache";
import { openSpeechStream, PcmStreamPlayer } from "~/lib/speech-stream";
import { type Segment, speechText } from "~/lib/state";
import type { StatusReporter } from "~/lib/status";
import { ScreenWakeLock } from "~/lib/wake-lock";
import { pcmDurationMs, pcmToWav } from "~/lib/wav";

type PlaybackProps = {
  segments: Segment[];
  genreHint?: string;
  voice?: string;
  onBack: () => void;
  onStatus: StatusReporter;
};

export default function Playback(props: PlaybackProps) {
  const [state, setState] = createSignal(initialPlaybackState);
  const [audioUrl, setAudioUrl] = createSignal<string>();
  const [duration, setDuration] = createSignal<number>();
  const [streaming, setStreaming] = createSignal(false);
  const [rate, setRate] = createSignal(1);
  const wakeLock = new ScreenWakeLock();
  const [keepAwake, setKeepAwake] = createSignal(false);
  const [prefetch, setPrefetch] = createSignal<{
    index: number;
    phase: "loading" | "ready";
  }>();
  let audio!: HTMLAudioElement;
  let heading!: HTMLHeadingElement;
  let request: AbortController | undefined;
  let prefetchRequest: AbortController | undefined;
  let streamPlayer: PcmStreamPlayer | undefined;
  let streamContext: AudioContext | undefined;

  const segment = () => props.segments[state().index];

  function speechInput(index: number): SpeechRequest | undefined {
    const target = props.segments[index];
    if (!target) return undefined;
    return {
      text: speechText(target),
      voice: props.voice,
      toneHint: target.suggestedToneHint || undefined,
      genreHint: props.genreHint,
    };
  }

  function dispatch(event: PlaybackEvent) {
    setState((current) => transitionPlayback(current, event, props.segments.length));
  }

  function captionsUrl() {
    const current = segment();
    const transcript = (current ? speechText(current) : "").replaceAll("-->", "→") ?? "";
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${transcript}`)}`;
  }

  function clearAudio() {
    audio?.pause();
    streamPlayer?.stop();
    streamPlayer = undefined;
    if (streamContext) void streamContext.close();
    streamContext = undefined;
    setStreaming(false);
    const url = untrack(audioUrl);
    if (url) URL.revokeObjectURL(url);
    setAudioUrl(undefined);
    setDuration(undefined);
  }

  function completePcm(chunks: Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
    const pcm = new Uint8Array(new ArrayBuffer(byteLength));
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return pcm;
  }

  async function prepare(event: "start" | "next" | "retry") {
    dispatch({ type: event });
    const nextState = state();
    if (nextState.phase !== "loading") return;

    request?.abort();
    request = new AbortController();
    const controller = request;
    clearAudio();
    props.onStatus(`正在產生第 ${nextState.index + 1} 段音訊…`);
    try {
      const input = speechInput(nextState.index);
      if (!input) throw new Error("找不到要播放的段落");
      const result = await requestCachedSpeech(input, request.signal, fetch, "playback");
      controller.signal.throwIfAborted();
      setAudioUrl(URL.createObjectURL(result.blob));
      setDuration(result.durationMs);
      dispatch({ type: "audio-ready" });
      props.onStatus(`第 ${nextState.index + 1} 段已準備，請按播放`, "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (controller.signal.aborted) return;
      const message = networkErrorMessage(error, "無法產生朗讀音訊");
      dispatch({ type: "fail", message });
      props.onStatus(message, "error");
    }
  }

  async function prefetchNext() {
    const index = state().index + 1;
    const input = speechInput(index);
    if (!input) return;
    if (prefetch()?.index === index) return;
    if (speechCache.get(input)) {
      setPrefetch({ index, phase: "ready" });
      return;
    }

    prefetchRequest?.abort();
    const controller = new AbortController();
    prefetchRequest = controller;
    setPrefetch({ index, phase: "loading" });
    try {
      await requestCachedSpeech(input, controller.signal, fetch, "prefetch");
      if (prefetchRequest === controller) setPrefetch({ index, phase: "ready" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setPrefetch(undefined);
    }
  }

  async function streamAndPlay(event: "start" | "retry") {
    dispatch({ type: event });
    const nextState = state();
    if (nextState.phase !== "loading") return;
    const input = speechInput(nextState.index);
    if (!input) return;

    const cached = speechCache.get(input);
    if (cached) {
      console.info(
        JSON.stringify({ event: "bragi.audio-cache", result: "hit", purpose: "playback" }),
      );
      clearAudio();
      setAudioUrl(URL.createObjectURL(cached.blob));
      setDuration(cached.durationMs);
      dispatch({ type: "audio-ready" });
      props.onStatus(`第 ${nextState.index + 1} 段已準備，請按播放`, "success");
      return;
    }
    // Web Audio sources cannot keep their pitch when sped up, so other speeds use complete WAV
    // audio with the browser's native pitch preservation instead of progressive streaming.
    if (typeof AudioContext === "undefined" || rate() !== 1) {
      await prepare(event);
      return;
    }

    request?.abort();
    const controller = new AbortController();
    request = controller;
    clearAudio();
    const context = new AudioContext({ sampleRate: 24_000 });
    context.addEventListener("statechange", () => handleInterruption(context));
    const player = new PcmStreamPlayer(context, 24_000);
    streamContext = context;
    streamPlayer = player;
    setStreaming(true);
    props.onStatus(`正在串流第 ${nextState.index + 1} 段音訊…`);

    try {
      await player.resume();
      const stream = await openSpeechStream(input, controller.signal);
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      let started = false;
      while (true) {
        const result = await stream.reader.read();
        if (result.done) break;
        const chunk = result.value.slice();
        chunks.push(chunk);
        byteLength += chunk.byteLength;
        player.append(chunk);
        if (!started) {
          started = true;
          dispatch({ type: "audio-ready" });
          dispatch({ type: "play" });
          props.onStatus(`正在播放第 ${nextState.index + 1} 段`);
          void prefetchNext();
        }
      }

      const pcm = completePcm(chunks, byteLength);
      controller.signal.throwIfAborted();
      const wav = pcmToWav(pcm);
      const audio = {
        blob: new Blob([wav], { type: "audio/wav" }),
        durationMs: pcmDurationMs(pcm.byteLength),
      };
      speechCache.set(input, audio);
      await player.finish();
      if (request !== controller) return;

      streamPlayer = undefined;
      streamContext = undefined;
      setStreaming(false);
      await context.close();
      setAudioUrl(URL.createObjectURL(audio.blob));
      setDuration(audio.durationMs);
      dispatch({ type: "ended" });
      props.onStatus(state().phase === "complete" ? "全部段落播放完成" : "本段播放完成", "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      player.stop();
      await context.close().catch(() => undefined);
      streamPlayer = undefined;
      streamContext = undefined;
      setStreaming(false);
      const message = networkErrorMessage(error, "串流播放失敗");
      dispatch({ type: "fail", message });
      props.onStatus(message, "error");
    }
  }

  async function play() {
    if (streaming()) {
      try {
        await streamPlayer?.resume();
        dispatch({ type: "play" });
        props.onStatus(`正在播放第 ${state().index + 1} 段`);
      } catch {
        props.onStatus("瀏覽器阻止播放，請再按一次播放按鈕", "error");
      }
      return;
    }
    if (!audioUrl()) return;
    try {
      audio.playbackRate = rate();
      audio.preservesPitch = true;
      await audio.play();
    } catch {
      props.onStatus("瀏覽器阻止播放，請再按一次播放按鈕", "error");
    }
  }

  /** Phones suspend or interrupt Web Audio for calls, lock screens and other apps. */
  function handleInterruption(context: AudioContext) {
    if (context !== streamContext || context.state === "running" || context.state === "closed")
      return;
    if (state().phase !== "playing") return;
    dispatch({ type: "pause" });
    props.onStatus("播放被系統中斷，請按「繼續播放」從中斷處恢復", "error");
  }

  async function pause() {
    // Update state first so the resulting suspension is not reported as an interruption.
    dispatch({ type: "pause" });
    if (streaming()) await streamPlayer?.pause();
    else audio.pause();
  }

  function leavePlayback() {
    request?.abort();
    prefetchRequest?.abort();
    clearAudio();
    props.onBack();
  }

  function navigate(index: number) {
    request?.abort();
    prefetchRequest?.abort();
    clearAudio();
    setPrefetch(undefined);
    setState({ index, phase: "idle" });
  }

  onCleanup(() => {
    request?.abort();
    prefetchRequest?.abort();
    clearAudio();
  });
  async function changeKeepAwake(enabled: boolean) {
    setKeepAwake(enabled);
    try {
      localStorage.setItem("bragi-keep-awake", String(enabled));
    } catch {}
    try {
      if (enabled) await wakeLock.enable();
      else await wakeLock.disable();
    } catch {
      setKeepAwake(false);
      props.onStatus("此裝置目前無法保持螢幕常亮", "error");
    }
  }

  onMount(() => {
    heading.focus();
    try {
      if (wakeLock.supported && localStorage.getItem("bragi-keep-awake") === "true") {
        setKeepAwake(true);
        wakeLock.enable().catch(() => setKeepAwake(false));
      }
    } catch {}
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") return;
      if (streamContext) handleInterruption(streamContext);
      wakeLock.reacquire().catch(() => setKeepAwake(false));
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      void wakeLock.disable().catch(() => undefined);
    });
  });

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
        <Show when={segment()?.spokenText}>
          {(spoken) => <p class="spoken-text">朗讀文字：{spoken()}</p>}
        </Show>
        <Show when={segment()?.suggestedToneHint}>
          <span>語氣：{segment()?.suggestedToneHint}</span>
        </Show>
      </article>
      <label for="playback-rate">播放速度</label>
      <select
        id="playback-rate"
        value={rate()}
        disabled={streaming() || state().phase === "playing" || state().phase === "loading"}
        onChange={(event) => setRate(Number(event.currentTarget.value))}
      >
        <option value="0.75">0.75 倍</option>
        <option value="1">1 倍</option>
        <option value="1.25">1.25 倍</option>
        <option value="1.5">1.5 倍</option>
      </select>
      <Show when={rate() !== 1}>
        <p class="rate-note">非 1 倍速會先產生整段音訊再播放，並保留原本的音高。</p>
      </Show>
      <Show when={wakeLock.supported}>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={keepAwake()}
            onChange={(event) => void changeKeepAwake(event.currentTarget.checked)}
          />
          朗讀時保持螢幕常亮
        </label>
      </Show>
      <nav aria-label="選擇朗讀段落">
        <button
          type="button"
          disabled={state().index === 0}
          onClick={() => navigate(state().index - 1)}
        >
          上一段
        </button>
        <button
          type="button"
          disabled={state().index >= props.segments.length - 1}
          onClick={() => navigate(state().index + 1)}
        >
          下一段
        </button>
      </nav>
      <progress
        aria-label="段落進度"
        max={props.segments.length}
        value={state().phase === "complete" ? props.segments.length : state().index}
      />

      <Show when={audioUrl()}>
        {(url) => (
          <div class="playback-audio">
            <audio
              ref={audio}
              controls
              preload="metadata"
              src={url()}
              aria-label={`第 ${state().index + 1} 段朗讀`}
              onPlay={() => {
                audio.playbackRate = rate();
                audio.preservesPitch = true;
                dispatch({ type: "play" });
                void prefetchNext();
              }}
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
            <button type="button" onClick={() => streamAndPlay("start")}>
              {state().index > 0 ? "播放此段" : rate() === 1 ? "串流播放第一段" : "播放第一段"}
            </button>
          </Match>
          <Match when={state().phase === "loading"}>
            <button type="button" disabled>
              正在產生音訊…
            </button>
          </Match>
          <Match when={state().phase === "ready"}>
            <button type="button" onClick={play}>
              {streaming() ? "繼續播放" : `播放第 ${state().index + 1} 段`}
            </button>
          </Match>
          <Match when={state().phase === "playing"}>
            <button type="button" onClick={pause}>
              暫停
            </button>
          </Match>
          <Match when={state().phase === "waiting"}>
            <Show when={prefetch()?.index === state().index + 1}>
              <p class="prefetch-status">
                {prefetch()?.phase === "ready" ? "下一段已準備完成" : "正在準備下一段…"}
              </p>
            </Show>
            <button type="button" class="secondary" onClick={play}>
              重播本段
            </button>
            <button type="button" onClick={() => prepare("next")}>
              {prefetch()?.phase === "ready" ? "繼續下一段" : "準備下一段"}
            </button>
          </Match>
          <Match when={state().phase === "error"}>
            <p role="alert">{state().error}</p>
            <button type="button" onClick={() => streamAndPlay("retry")}>
              重試本段
            </button>
          </Match>
          <Match when={state().phase === "complete"}>
            <p>全部段落播放完成。</p>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "reset" });
                void streamAndPlay("start");
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
