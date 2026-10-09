import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { useApp } from "~/lib/app-controller";
import type { AudioSnapshot } from "~/lib/audio/controller";
import { audioTime, createAudioSession } from "~/lib/audio/session";
import { t } from "~/lib/i18n";
import { describeError } from "~/lib/network";
import {
  type PlaybackEvent,
  type PlaybackState,
  playbackSegment,
  transitionPlayback,
} from "~/lib/playback";
import { playbackAction, playbackShortcut } from "~/lib/playback-ui";
import type { SpeechRequest } from "~/lib/speech";
import type { Segment } from "~/lib/state";
import { speechText } from "~/lib/state";
import type { StatusMessage } from "~/lib/status";
import { availableVoices, keepAwake, playbackRate, voice } from "~/lib/store/preferences";
import { workspace } from "~/lib/store/workspace";
import { voiceLabel } from "~/lib/voices";
import { ScreenWakeLock } from "~/lib/wake-lock";
import Button from "./ui/Button";
import InlineStatus from "./ui/InlineStatus";

type PlaybackProps = {
  requestRevision?: object;
  segments: Segment[];
  genreHint?: string;
  voice?: string;
  onBack: () => void;
  onSettings: () => void;
  onFinished: () => void;
};

export default function Playback(props: PlaybackProps) {
  const app = useApp();
  const identities = () =>
    props.segments.map((segment) => playbackSegment(segment, props.genreHint));
  const [state, setState] = createSignal<PlaybackState>({
    index: untrack(workspace.currentSegment),
    phase: "idle",
    played: untrack(workspace.played),
  });
  const [notice, setNotice] = createSignal<StatusMessage>();
  const [prefetch, setPrefetch] = createSignal<{
    key: string;
    settings: string;
    abort: AbortController;
  }>();
  const wakeLock = new ScreenWakeLock();
  let disposed = false;
  let heading!: HTMLHeadingElement;
  let lastPhase = "";
  const session = createAudioSession("main", reflect);
  const snapshot = session.snapshot;
  const phase = createMemo(() => state().phase);
  const error = createMemo(() => snapshot().error);
  const segment = () => props.segments[state().index];
  const nextSegment = () => props.segments[state().index + 1];
  const key = (index: number) => JSON.stringify(identities()[index]);
  const input = (index: number): SpeechRequest => {
    const entry = props.segments[index];
    return {
      text: entry ? speechText(entry) : "",
      voice: props.voice,
      toneHint: entry?.suggestedToneHint || undefined,
      genreHint: props.genreHint,
    };
  };
  function dispatch(event: PlaybackEvent) {
    setState((current) => transitionPlayback(current, event, props.segments.length, identities()));
  }
  function reflect(value: AudioSnapshot) {
    const signature = `${value.generation}:${value.phase}:${value.segmentKey}`;
    if (signature === lastPhase) return;
    lastPhase = signature;
    if (value.owner !== "main") {
      if (untrack(phase) !== "idle") dispatch({ type: "stop" });
      return;
    }
    if (value.segmentKey !== key(untrack(() => state().index))) return;
    if (value.phase === "ended") {
      // A retained PCM tail can already be at EOF when resume confirms completion.
      dispatch({ type: "play" });
      dispatch({ type: "ended" });
      const identity = untrack(() => state().activeSegment);
      if (
        identity &&
        untrack(() => state().played)?.some(
          (entry) => entry.id === identity.id && entry.version === identity.version,
        )
      )
        workspace.recordPlayback(identity, (value.duration ?? value.bufferedDuration) / value.rate);
    } else {
      const nextPhase = value.phase;
      setState((current) => ({ ...current, phase: nextPhase, reason: value.reason }));
    }
  }
  createEffect(() => workspace.setCurrentSegment(state().index));
  const settingsChanged = () =>
    !!snapshot().input &&
    (snapshot().input?.voice !== voice() || snapshot().rate !== playbackRate());
  const status = createMemo<StatusMessage | undefined>(() => {
    if (phase() === "error")
      return { ...describeError(error(), t("playback.failed")), tone: "error" };
    if (phase() === "blocked") return { message: t("playback.blocked"), tone: "error" };
    if (phase() === "interrupted")
      return {
        message: t(
          snapshot().reason === "visibility"
            ? "playback.visibilityInterrupted"
            : "playback.interrupted",
        ),
        tone: "error",
      };
    if (phase() === "loading") return { message: t("playback.preparing"), tone: "info" };
    if (phase() === "complete")
      return {
        message:
          workspace.played().length === props.segments.length
            ? t("playback.allDone")
            : t("playback.reachedEnd", { n: props.segments.length - workspace.played().length }),
        tone: "success",
      };
    return notice();
  });
  const played = (index: number) =>
    workspace
      .played()
      .some(
        (entry) =>
          entry.id === identities()[index]?.id && entry.version === identities()[index]?.version,
      );
  const prepared = (index: number) => {
    snapshot();
    voice();
    playbackRate();
    return (
      typeof window !== "undefined" &&
      session.controller().isPrepared({ segmentKey: key(index), input: input(index) })
    );
  };
  const preparing = (index: number) =>
    (state().index === index && phase() === "loading") || prefetch()?.key === key(index);
  const badge = (index: number) =>
    t(
      played(index)
        ? "playback.played"
        : preparing(index)
          ? "playback.preparingBadge"
          : prepared(index)
            ? "playback.prepared"
            : "playback.unprepared",
    );

  function cancelPreload() {
    prefetch()?.abort.abort();
    setPrefetch(undefined);
  }
  function navigate(index: number) {
    if (index < 0 || index >= props.segments.length) return;
    session.controller().stop("main");
    cancelPreload();
    setNotice(undefined);
    dispatch({ type: "navigate", index });
  }
  function start(index = state().index) {
    session.controller().stop("main");
    setNotice(undefined);
    dispatch({ type: "navigate", index });
    dispatch({ type: "start" });
    // Direct gesture call: never await synthesis before asking the controller to play.
    void session
      .controller()
      .play({
        owner: "main",
        segmentKey: key(index),
        input: input(index),
        captionsLabel: t("audio.captions"),
      })
      .catch((failure) => {
        if (disposed) return;
        setNotice({ ...describeError(failure, t("playback.failed")), tone: "error" });
        dispatch({ type: "fail", message: t("playback.failed") });
      });
    // play() subscribes to an in-flight WAV synchronously, before this preload releases its
    // subscription. Cancelling it earlier would abort the shared request and synthesize twice.
    cancelPreload();
  }
  function primary() {
    switch (phase()) {
      case "loading":
        return;
      case "playing":
        session.controller().pause("main");
        return;
      case "paused":
      case "blocked":
      case "interrupted":
        void session.controller().resume("main");
        return;
      case "waiting":
        start(state().index + 1);
        return;
      case "complete":
        props.onFinished();
        return;
      default:
        start();
    }
  }
  function cancel() {
    session.controller().stop("main");
    cancelPreload();
    setNotice(undefined);
    dispatch({ type: "stop" });
  }
  createEffect(
    on(
      () => props.requestRevision,
      () => {
        cancel();
        session.controller().invalidatePreloads();
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => [state().index, phase(), voice(), playbackRate()],
      () => {
        if (!["playing", "waiting", "complete"].includes(phase()) || !nextSegment()) return;
        const index = state().index + 1;
        const settings = JSON.stringify([voice(), playbackRate()]);
        const existing = untrack(prefetch);
        if (
          existing?.key === key(index) &&
          existing.settings === settings &&
          !existing.abort.signal.aborted
        )
          return;
        if (prepared(index)) {
          cancelPreload();
          return;
        }
        const pending = { key: key(index), settings, abort: new AbortController() };
        void session
          .controller()
          .preload({ segmentKey: pending.key, input: input(index), signal: pending.abort.signal })
          .catch(() => undefined)
          .finally(() => {
            if (!disposed && untrack(prefetch) === pending) setPrefetch(undefined);
          });
        // As in start(): the replacement joins a shared WAV request (same text and voice, another
        // rate) before the old preload leaves, so the shared request is not aborted and redone.
        cancelPreload();
        setPrefetch(pending);
      },
    ),
  );
  createEffect(
    on(keepAwake, (enabled) => {
      if (!wakeLock.supported) return;
      void (enabled ? wakeLock.enable() : wakeLock.disable()).catch(() => {
        if (!disposed && enabled)
          setNotice({ message: t("playback.keepAwakeFailed"), tone: "error" });
      });
    }),
  );
  onMount(() => {
    heading.focus();
    const keyboard = (event: KeyboardEvent) => {
      const action = playbackShortcut(
        event,
        app.settingsOpen() || !!app.pendingLoss() || !!document.querySelector("dialog[open]"),
      );
      if (!action) return;
      event.preventDefault();
      if (action === "toggle") primary();
      else navigate(state().index + (action === "previous" ? -1 : 1));
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void wakeLock.reacquire().catch(() => undefined);
    };
    document.addEventListener("keydown", keyboard);
    document.addEventListener("visibilitychange", visibility);
    onCleanup(() => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("visibilitychange", visibility);
    });
  });
  onCleanup(() => {
    disposed = true;
    cancelPreload();
    void wakeLock.disable().catch(() => undefined);
  });
  return (
    <section class="playback" aria-label={t("playback.eyebrow")} data-phase={phase()}>
      <div class="playback-layout">
        <article class="playback-script" aria-label={t("playback.transcript")}>
          <Show when={segment()?.suggestedToneHint}>
            <span class="playback-tone">
              {t("playback.tone", { tone: segment()?.suggestedToneHint ?? "" })}
            </span>
          </Show>
          <p class="reading-text">{segment()?.text}</p>
          <Show when={segment()?.spokenText} keyed>
            {(text) => (
              <details class="playback-correction">
                <summary>{t("playback.correction")}</summary>
                <p>{t("playback.spokenText", { text })}</p>
              </details>
            )}
          </Show>
          <Show when={nextSegment()}>
            <p class="playback-next-preview">
              {t("playback.nextPreview", { text: nextSegment()?.text.slice(0, 70) ?? "" })}
            </p>
          </Show>
        </article>
        <aside class="playback-controls">
          <nav class="playback-selector" aria-label={t("playback.segmentNav")}>
            <h1 ref={heading} id="playback-heading" tabindex="-1" class="playback-position">
              {t("playback.heading", { n: state().index + 1, total: props.segments.length })}
            </h1>
            <ul class="playback-legend">
              <li data-state="played">{t("playback.played")}</li>
              <li data-state="prepared">{t("playback.prepared")}</li>
              <li data-state="preparing">{t("playback.preparingBadge")}</li>
            </ul>
            <ol class="playback-segments" aria-label={t("playback.segments")}>
              <For each={props.segments}>
                {(entry, index) => (
                  <li>
                    <Button
                      variant="ghost"
                      size="compact"
                      aria-current={state().index === index() ? "true" : undefined}
                      class="playback-segment-button"
                      aria-label={`${t("playback.selectSegment", { n: index() + 1 })} · ${badge(index())}`}
                      onClick={() => navigate(index())}
                    >
                      <span>{index() + 1}</span>
                      <span class="segment-excerpt">{entry.text}</span>
                      <span
                        class="segment-dot"
                        data-state={
                          played(index())
                            ? "played"
                            : preparing(index())
                              ? "preparing"
                              : prepared(index())
                                ? "prepared"
                                : "unprepared"
                        }
                        aria-hidden="true"
                      />
                    </Button>
                  </li>
                )}
              </For>
            </ol>
          </nav>
          <div class="playback-transport">
            <div class="playback-status-slot">
              <Show
                when={status()}
                fallback={
                  <div class="playback-meter">
                    <span class="playback-clock">
                      {audioTime(snapshot().position)}
                      <Show
                        when={snapshot().duration}
                      >{` / ${audioTime(snapshot().duration ?? 0)}`}</Show>
                    </span>
                  </div>
                }
              >
                <InlineStatus status={status()} />
              </Show>
            </div>
            <input
              class="playback-seek"
              type="range"
              style={{
                "--position": `${snapshot().duration ? Math.min(100, (snapshot().position / (snapshot().duration ?? 1)) * 100) : 0}%`,
              }}
              aria-label={t("playback.seek")}
              min="0"
              max={snapshot().duration ?? 0}
              step="0.1"
              value={snapshot().position}
              disabled={!snapshot().seekable}
              aria-valuetext={audioTime(snapshot().position)}
              onInput={(event) =>
                void session.controller().seek("main", Number(event.currentTarget.value))
              }
            />
            <Button
              class="playback-primary"
              wide
              disabled={phase() === "loading"}
              onClick={primary}
            >
              {t(playbackAction(phase()))}
            </Button>
            <div class="playback-secondary">
              <Button
                variant="secondary"
                class="playback-secondary-button"
                size="compact"
                disabled={state().index === 0}
                onClick={() => navigate(state().index - 1)}
              >
                {t("playback.previous")}
              </Button>
              <Button
                variant="secondary"
                class="playback-secondary-button"
                size="compact"
                disabled={phase() === "idle"}
                onClick={() => (phase() === "loading" ? cancel() : start())}
              >
                {t(phase() === "loading" ? "playback.cancel" : "playback.replay")}
              </Button>
              <Button
                variant="secondary"
                class="playback-secondary-button"
                size="compact"
                disabled={state().index >= props.segments.length - 1}
                onClick={() => navigate(state().index + 1)}
              >
                {t("playback.next")}
              </Button>
            </div>
            <div class="playback-settings-summary">
              <div class="playback-footer-actions">
                <Button
                  variant="ghost"
                  class="playback-settings-button"
                  size="compact"
                  onClick={props.onSettings}
                >
                  {t("playback.voiceRate", {
                    voice: voiceLabel(
                      snapshot().input
                        ? (snapshot().input?.voice ?? availableVoices()[0] ?? "")
                        : (voice() ?? availableVoices()[0] ?? ""),
                    ),
                    rate: snapshot().input ? snapshot().rate : playbackRate(),
                  })}
                </Button>
                <Button
                  variant="ghost"
                  class="playback-back-button"
                  size="compact"
                  onClick={props.onBack}
                >
                  {t("playback.back")}
                </Button>
              </div>
              <Show when={settingsChanged()}>
                <p class="playback-settings-note">
                  {t("playback.nextSettings", {
                    voice: voiceLabel(voice() ?? availableVoices()[0] ?? ""),
                    rate: playbackRate(),
                  })}
                </p>
              </Show>
              <Show when={playbackRate() !== 1}>
                <p class="playback-settings-note">{t("playback.rateNote")}</p>
              </Show>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
