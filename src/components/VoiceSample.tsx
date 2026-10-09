import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { type AudioClaim, claimAudio } from "~/lib/audio-focus";
import { t } from "~/lib/i18n";
import { requestSpeech } from "~/lib/speech";
import { reportError, type StatusMessage, type StatusReporter } from "~/lib/status";
import { VOICE_SAMPLE_TEXT, voiceLabel } from "~/lib/voices";
import Button from "./ui/Button";
import InlineStatus from "./ui/InlineStatus";

type VoiceSampleProps = {
  requestRevision?: object;
  voice?: string;
  /** False once the settings panel closes: the sample stops and any request is cancelled. */
  active: boolean;
  describedBy?: string;
};

/** Plays a fixed sentence per voice. Samples stay out of the narration cache so they never evict it. */
export default function VoiceSample(props: VoiceSampleProps) {
  const samples = new Map<string, string>();
  const [busy, setBusy] = createSignal(false);
  const [current, setCurrent] = createSignal<{ voice: string; url: string }>();
  const [status, setStatus] = createSignal<StatusMessage>();
  const report: StatusReporter = (message, tone = "info", details) =>
    setStatus({ message, tone, details });
  let request: AbortController | undefined;
  let audioElement: HTMLAudioElement | undefined;
  let claim: AudioClaim | undefined;

  function stop() {
    request?.abort();
    request = undefined;
    setBusy(false);
    audioElement?.pause();
  }

  /** Narration pauses before a sample starts, so the two never play over each other. */
  function takeFocus() {
    claim?.release();
    claim = claimAudio(() => audioElement?.pause());
  }

  createEffect(
    on(
      () => [props.voice, props.requestRevision],
      () => {
        request?.abort();
        request = undefined;
        setBusy(false);
        setStatus(undefined);
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (active) return;
        stop();
        setStatus(undefined);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    stop();
    claim?.release();
    for (const url of samples.values()) URL.revokeObjectURL(url);
  });

  async function generate() {
    const voice = props.voice;
    if (!voice) return;
    takeFocus();
    const cached = samples.get(voice);
    if (cached) {
      setCurrent({ voice, url: cached });
      return;
    }
    request?.abort();
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    report(t("voiceSample.generating", { voice: voiceLabel(voice) }));
    try {
      const audio = await requestSpeech({ text: VOICE_SAMPLE_TEXT, voice }, controller.signal);
      if (request !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(audio.blob);
      samples.set(voice, url);
      if (props.voice === voice) setCurrent({ voice, url });
      report(t("voiceSample.ready"), "success");
    } catch (error) {
      if (controller.signal.aborted) return;
      reportError(report, error, t("voiceSample.failed"));
    } finally {
      if (request === controller) setBusy(false);
    }
  }

  return (
    <div class="voice-sample">
      <Button
        variant="secondary"
        size="compact"
        disabled={busy() || !props.voice}
        aria-describedby={props.describedBy}
        onClick={generate}
      >
        {busy() ? t("common.generating") : t("voiceSample.play")}
      </Button>
      <Show when={current()?.voice === props.voice ? current() : undefined}>
        {(sample) => (
          <audio
            ref={audioElement}
            controls
            preload="metadata"
            src={sample().url}
            aria-label={t("voiceSample.audio")}
            onPlay={takeFocus}
          >
            <track
              kind="captions"
              src={`data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${VOICE_SAMPLE_TEXT}`)}`}
              label={t("voiceSample.captions")}
              default
            />
          </audio>
        )}
      </Show>
      <InlineStatus status={status()} />
    </div>
  );
}
