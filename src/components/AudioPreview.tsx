import { createEffect, createMemo, createUniqueId, on, Show } from "solid-js";
import type { AudioOwner } from "~/lib/audio/controller";
import { audioTime, createAudioSession, seekPosition } from "~/lib/audio/session";
import { t } from "~/lib/i18n";
import { describeError } from "~/lib/network";
import type { SpeechRequest } from "~/lib/speech";
import type { StatusMessage } from "~/lib/status";
import Button from "./ui/Button";
import InlineStatus from "./ui/InlineStatus";

/** Shared custom controls. No preview creates an audio element or a second output coordinator. */
export default function AudioPreview(props: {
  owner: Exclude<AudioOwner, "main">;
  input: SpeechRequest;
  label: string;
  playLabel: string;
  active: boolean;
  valid: boolean;
  requestRevision?: object;
  describedBy?: string;
  /** The language of `input.text` when it may differ from the interface. */
  lang?: string;
  /**
   * A one-button preview for lists: play, cancel while preparing, stop while playing. The visible
   * text stays short and the accessible name adds `subject`.
   */
  compact?: { subject: string };
}) {
  const id = createUniqueId();
  const key = () => JSON.stringify([props.owner, id, props.input]);
  const session = createAudioSession(props.owner, undefined, key);
  const current = () =>
    session.snapshot().segmentKey === key() && session.snapshot().owner === props.owner;
  const phase = createMemo(() => (current() ? session.snapshot().phase : "idle"));
  const error = createMemo(() => session.snapshot().error);
  const status = createMemo<StatusMessage | undefined>(() => {
    if (phase() === "error")
      return {
        ...describeError(
          error(),
          t(props.owner === "sample" ? "voiceSample.failed" : "preview.failed"),
        ),
        tone: "error",
      };
    if (phase() === "blocked") return { message: t("playback.blocked"), tone: "error" };
    if (phase() === "interrupted") return { message: t("playback.interrupted"), tone: "error" };
    if (phase() === "loading") return { message: t("playback.preparing"), tone: "info" };
    return undefined;
  });
  createEffect(
    on(
      () => [key(), props.requestRevision, props.active],
      (_, previous) => {
        if (session.controller().snapshot.segmentKey === previous?.[0])
          session.controller().stop(props.owner);
      },
      { defer: true },
    ),
  );
  function play() {
    if (!props.valid || !props.active) return;
    if (phase() === "playing") session.controller().pause(props.owner);
    else if (["paused", "interrupted", "blocked"].includes(phase()))
      void session.controller().resume(props.owner);
    else
      void session.controller().play({
        owner: props.owner,
        segmentKey: key(),
        input: props.input,
        rate: props.owner === "sample" ? 1 : undefined,
        captionsLabel: t("audio.captions"),
      });
  }
  function act() {
    if (phase() === "loading" || phase() === "playing") session.controller().stop(props.owner);
    else play();
  }
  const compactLabel = () =>
    t(
      phase() === "loading"
        ? "playback.cancel"
        : phase() === "playing"
          ? "playback.stop"
          : ["paused", "interrupted"].includes(phase())
            ? "playback.resume"
            : phase() === "blocked"
              ? "playback.tapToPlay"
              : phase() === "error"
                ? "playback.retry"
                : "voicePicker.preview",
    );
  const buttonLabel = () =>
    t(
      phase() === "playing"
        ? "playback.pause"
        : phase() === "blocked"
          ? "playback.tapToPlay"
          : ["paused", "interrupted"].includes(phase())
            ? "playback.resume"
            : phase() === "loading"
              ? "common.generating"
              : phase() === "error"
                ? "playback.retry"
                : "preview.generate",
    );
  if (props.compact)
    return (
      <div class="voice-sample voice-sample-compact" data-phase={phase()}>
        <Button
          variant={phase() === "playing" || phase() === "loading" ? "primary" : "secondary"}
          size="compact"
          disabled={!props.valid || !props.active}
          aria-label={t("voicePicker.action", {
            action: compactLabel(),
            voice: props.compact?.subject ?? "",
          })}
          aria-describedby={props.describedBy}
          onClick={act}
        >
          {compactLabel()}
        </Button>
        <InlineStatus status={status()} />
      </div>
    );
  return (
    <div class={props.owner === "sample" ? "voice-sample" : "speech-preview"}>
      <Button
        variant="secondary"
        size="compact"
        disabled={!props.valid || !props.active || phase() === "loading"}
        aria-describedby={props.describedBy}
        onClick={play}
      >
        {phase() === "idle" || phase() === "ended" ? props.playLabel : buttonLabel()}
      </Button>
      <Show when={current() && phase() !== "idle"}>
        <fieldset class="preview-transport" aria-label={props.label}>
          <label class="preview-seek-label">
            {t("playback.seek")}
            <input
              class="seek preview-seek"
              type="range"
              style={{ "--position": seekPosition(session.snapshot()) }}
              min="0"
              step="0.1"
              max={session.snapshot().duration ?? 0}
              value={session.snapshot().position}
              disabled={!session.snapshot().seekable}
              aria-valuetext={audioTime(session.snapshot().position)}
              onInput={(event) =>
                void session.controller().seek(props.owner, Number(event.currentTarget.value))
              }
            />
          </label>
          <span>
            {audioTime(session.snapshot().position)}
            <Show
              when={session.snapshot().duration}
            >{` / ${audioTime(session.snapshot().duration ?? 0)}`}</Show>
          </span>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => session.controller().stop(props.owner)}
          >
            {t(phase() === "loading" ? "playback.cancel" : "playback.stop")}
          </Button>
          <details open={props.owner === "sample"}>
            <summary>{t("playback.transcript")}</summary>
            <p class="preview-transcript" lang={props.lang}>
              {props.input.text}
            </p>
          </details>
        </fieldset>
      </Show>
      <InlineStatus status={status()} />
    </div>
  );
}
