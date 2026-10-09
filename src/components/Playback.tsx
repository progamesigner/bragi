import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { type AudioClaim, claimAudio } from "~/lib/audio-focus";
import { t } from "~/lib/i18n";
import { type PlaybackEvent, type PlaybackState, transitionPlayback } from "~/lib/playback";
import type { SpeechRequest } from "~/lib/speech";
import { requestCachedSpeech, speechCache } from "~/lib/speech-cache";
import { openSpeechStream, PcmStreamPlayer } from "~/lib/speech-stream";
import { type Segment, speechText } from "~/lib/state";
import { reportError, type StatusMessage, type StatusReporter } from "~/lib/status";
import { keepAwake, playbackRate, playbackSettings } from "~/lib/store/preferences";
import { workspace } from "~/lib/store/workspace";
import { ScreenWakeLock } from "~/lib/wake-lock";
import { pcmDurationMs, pcmToWav } from "~/lib/wav";
import Button from "./ui/Button";
import InlineStatus from "./ui/InlineStatus";

type PlaybackProps = {
  requestRevision?: object;
  segments: Segment[];
  genreHint?: string;
  voice?: string;
  onBack: () => void;
  onSettings: () => void;
};

export default function Playback(props: PlaybackProps) {
  // Resume on the segment the workspace remembers, so leaving playback does not lose the place.
  const [state, setState] = createSignal<PlaybackState>({
    index: untrack(workspace.currentSegment),
    phase: "idle",
  });
  createEffect(() => workspace.setCurrentSegment(state().index));
  const [audioUrl, setAudioUrl] = createSignal<string>();
  const [duration, setDuration] = createSignal<number>();
  const [streaming, setStreaming] = createSignal(false);
  const wakeLock = new ScreenWakeLock();
  // Progress and errors stay next to the controls; nothing here goes to the app-wide toast.
  const [status, setStatus] = createSignal<StatusMessage>();
  const report: StatusReporter = (message, tone = "info", details) =>
    setStatus({ message, tone, details });
  let claim: AudioClaim | undefined;
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
  let disposed = false;

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

  createEffect(
    on(
      () => props.requestRevision,
      () => {
        request?.abort();
        prefetchRequest?.abort();
        clearAudio();
        setPrefetch(undefined);
        setState({ index: state().index, phase: "idle" });
      },
      { defer: true },
    ),
  );

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
    report(t("playback.preparingNumber", { n: nextState.index + 1 }));
    try {
      const input = speechInput(nextState.index);
      if (!input) throw new Error(t("playback.missingSegment"));
      const result = await requestCachedSpeech(input, request.signal, fetch, "playback");
      controller.signal.throwIfAborted();
      setAudioUrl(URL.createObjectURL(result.blob));
      setDuration(result.durationMs);
      dispatch({ type: "audio-ready" });
      report(t("playback.readyNumber", { n: nextState.index + 1 }), "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (controller.signal.aborted) return;
      const message = reportError(report, error, t("playback.failed"));
      dispatch({ type: "fail", message });
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
      if (prefetchRequest === controller && !controller.signal.aborted)
        setPrefetch({ index, phase: "ready" });
    } catch (error) {
      if (prefetchRequest !== controller || controller.signal.aborted) return;
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
      report(t("playback.readyNumber", { n: nextState.index + 1 }), "success");
      return;
    }
    // Web Audio sources cannot keep their pitch when sped up, so other speeds use complete WAV
    // audio with the browser's native pitch preservation instead of progressive streaming.
    if (typeof AudioContext === "undefined" || playbackSettings().rate !== 1) {
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
    report(t("playback.streamingNumber", { n: nextState.index + 1 }));

    try {
      await player.resume();
      controller.signal.throwIfAborted();
      const stream = await openSpeechStream(input, controller.signal);
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      let started = false;
      while (true) {
        const result = await stream.reader.read();
        controller.signal.throwIfAborted();
        if (result.done) break;
        const chunk = result.value.slice();
        chunks.push(chunk);
        byteLength += chunk.byteLength;
        player.append(chunk);
        if (!started) {
          started = true;
          dispatch({ type: "audio-ready" });
          dispatch({ type: "play" });
          report(t("playback.playingNumber", { n: nextState.index + 1 }));
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
      if (request !== controller || controller.signal.aborted) return;

      streamPlayer = undefined;
      streamContext = undefined;
      setStreaming(false);
      await context.close();
      if (request !== controller || controller.signal.aborted) return;
      setAudioUrl(URL.createObjectURL(audio.blob));
      setDuration(audio.durationMs);
      dispatch({ type: "ended" });
      report(
        t(state().phase === "complete" ? "playback.complete" : "playback.segmentDone"),
        "success",
      );
    } catch (error) {
      player.stop();
      await context.close().catch(() => undefined);
      if (request !== controller || controller.signal.aborted) return;
      streamPlayer = undefined;
      streamContext = undefined;
      setStreaming(false);
      const message = reportError(report, error, t("playback.streamFailed"));
      dispatch({ type: "fail", message });
    }
  }

  async function play() {
    const currentRequest = request;
    if (streaming()) {
      try {
        await streamPlayer?.resume();
        if (disposed || request !== currentRequest || currentRequest?.signal.aborted) return;
        dispatch({ type: "play" });
        report(t("playback.playingNumber", { n: state().index + 1 }));
      } catch {
        if (disposed || request !== currentRequest || currentRequest?.signal.aborted) return;
        report(t("playback.blocked"), "error");
      }
      return;
    }
    if (!audioUrl()) return;
    try {
      audio.playbackRate = playbackSettings().rate;
      audio.preservesPitch = true;
      await audio.play();
    } catch {
      if (disposed || request !== currentRequest || currentRequest?.signal.aborted) return;
      report(t("playback.blocked"), "error");
    }
  }

  /** Phones suspend or interrupt Web Audio for calls, lock screens and other apps. */
  function handleInterruption(context: AudioContext) {
    if (context !== streamContext || context.state === "running" || context.state === "closed")
      return;
    if (state().phase !== "playing") return;
    dispatch({ type: "pause" });
    report(t("playback.interrupted"), "error");
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
    disposed = true;
    request?.abort();
    prefetchRequest?.abort();
    clearAudio();
    claim?.release();
  });

  // Only one source sounds at a time: starting narration pauses a voice sample, and a sample
  // (or anything else that claims audio) pauses narration.
  createEffect(
    on(
      () => state().phase === "playing",
      (playing) => {
        claim?.release();
        claim = playing ? claimAudio(() => void pause()) : undefined;
      },
    ),
  );

  // The preference can change from settings on any screen; only this screen holds the lock.
  createEffect(
    on(keepAwake, (enabled) => {
      if (!wakeLock.supported) return;
      const change = enabled ? wakeLock.enable() : wakeLock.disable();
      change.catch(() => {
        if (!disposed && enabled) report(t("playback.keepAwakeFailed"), "error");
      });
    }),
  );

  onMount(() => {
    heading.focus();
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") return;
      if (streamContext) handleInterruption(streamContext);
      wakeLock.reacquire().catch(() => undefined);
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
          <p class="eyebrow">{t("playback.eyebrow")}</p>
          <h1 ref={heading} id="playback-heading" tabindex="-1">
            {t("playback.heading", { n: state().index + 1, total: props.segments.length })}
          </h1>
        </div>
        <Button variant="secondary" size="compact" onClick={leavePlayback}>
          {t("playback.back")}
        </Button>
      </div>

      <div class="playback-layout">
        <article class="playback-script" aria-live="polite">
          <p>{segment()?.text}</p>
          <Show when={segment()?.spokenText}>
            {(spoken) => <p class="spoken-text">{t("playback.spokenText", { text: spoken() })}</p>}
          </Show>
          <Show when={segment()?.suggestedToneHint}>
            <span>{t("playback.tone", { tone: segment()?.suggestedToneHint ?? "" })}</span>
          </Show>
        </article>
        <aside class="playback-controls">
          <ol class="playback-segments" aria-label={t("playback.segments")}>
            <For each={props.segments}>
              {(entry, index) => (
                <li>
                  <Button
                    variant="ghost"
                    wide
                    aria-current={state().index === index() ? "true" : undefined}
                    class="playback-segment-button"
                    aria-label={t("playback.selectSegment", { n: index() + 1 })}
                    onClick={() => navigate(index())}
                  >
                    <span>{index() + 1}</span>
                    <span class="segment-excerpt">{entry.text}</span>
                  </Button>
                </li>
              )}
            </For>
          </ol>
          <div class="playback-rate">
            <p>{t("playback.rateCurrent", { n: playbackRate() })}</p>
            <Button variant="ghost" size="compact" onClick={props.onSettings}>
              {t("playback.rateChange")}
            </Button>
          </div>
          <nav class="playback-nav" aria-label={t("playback.segmentNav")}>
            <Button
              variant="secondary"
              disabled={state().index === 0}
              onClick={() => navigate(state().index - 1)}
            >
              {t("playback.previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={state().index >= props.segments.length - 1}
              onClick={() => navigate(state().index + 1)}
            >
              {t("playback.next")}
            </Button>
          </nav>
          <progress
            aria-label={t("playback.progress")}
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
                  aria-label={t("playback.audio", { n: state().index + 1 })}
                  onPlay={() => {
                    audio.playbackRate = playbackSettings().rate;
                    audio.preservesPitch = true;
                    dispatch({ type: "play" });
                    void prefetchNext();
                  }}
                  onPause={() => {
                    if (!audio.ended) dispatch({ type: "pause" });
                  }}
                  onEnded={() => {
                    dispatch({ type: "ended" });
                    report(
                      t(
                        state().phase === "complete" ? "playback.complete" : "playback.segmentDone",
                      ),
                      "success",
                    );
                  }}
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

          <InlineStatus status={status()} class="playback-status" />
          <div class="playback-actions">
            <Switch>
              <Match when={state().phase === "idle"}>
                <Button onClick={() => streamAndPlay("start")}>
                  {t(
                    state().index > 0
                      ? "playback.playThis"
                      : playbackRate() === 1
                        ? "playback.streamFirst"
                        : "playback.playFirst",
                  )}
                </Button>
              </Match>
              <Match when={state().phase === "loading"}>
                <Button disabled>{t("playback.generating")}</Button>
              </Match>
              <Match when={state().phase === "ready"}>
                <Button onClick={play}>
                  {streaming()
                    ? t("playback.resume")
                    : t("playback.playNumber", { n: state().index + 1 })}
                </Button>
              </Match>
              <Match when={state().phase === "playing"}>
                <Button onClick={pause}>{t("playback.pause")}</Button>
              </Match>
              <Match when={state().phase === "waiting"}>
                <Show when={prefetch()?.index === state().index + 1}>
                  <p class="prefetch-status">
                    {t(
                      prefetch()?.phase === "ready"
                        ? "playback.nextReady"
                        : "playback.nextPreparing",
                    )}
                  </p>
                </Show>
                <Button variant="secondary" onClick={play}>
                  {t("playback.replay")}
                </Button>
                <Button onClick={() => prepare("next")}>
                  {t(
                    prefetch()?.phase === "ready"
                      ? "playback.continueNext"
                      : "playback.prepareNext",
                  )}
                </Button>
              </Match>
              <Match when={state().phase === "error"}>
                <Button onClick={() => streamAndPlay("retry")}>{t("playback.retry")}</Button>
              </Match>
              <Match when={state().phase === "complete"}>
                <p>{t("playback.allDone")}</p>
                <Button
                  onClick={() => {
                    dispatch({ type: "reset" });
                    void streamAndPlay("start");
                  }}
                >
                  {t("playback.restart")}
                </Button>
              </Match>
            </Switch>
          </div>
        </aside>
      </div>
    </section>
  );
}
