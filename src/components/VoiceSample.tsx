import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { t } from "~/lib/i18n";
import { requestSpeech } from "~/lib/speech";
import { reportError, type StatusReporter } from "~/lib/status";
import { VOICE_SAMPLE_TEXT, voiceLabel } from "~/lib/voices";
import Button from "./ui/Button";

type VoiceSampleProps = {
  requestRevision?: object;
  voice?: string;
  onStatus: StatusReporter;
};

/** Plays a fixed sentence per voice. Samples stay out of the narration cache so they never evict it. */
export default function VoiceSample(props: VoiceSampleProps) {
  const samples = new Map<string, string>();
  const [busy, setBusy] = createSignal(false);
  const [current, setCurrent] = createSignal<{ voice: string; url: string }>();
  let request: AbortController | undefined;
  let audioElement: HTMLAudioElement | undefined;

  createEffect(
    on(
      () => [props.voice, props.requestRevision],
      () => {
        request?.abort();
        request = undefined;
        setBusy(false);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    request?.abort();
    request = undefined;
    audioElement?.pause();
    for (const url of samples.values()) URL.revokeObjectURL(url);
  });

  async function generate() {
    const voice = props.voice;
    if (!voice) return;
    const cached = samples.get(voice);
    if (cached) {
      setCurrent({ voice, url: cached });
      return;
    }
    request?.abort();
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    props.onStatus(t("voiceSample.generating", { voice: voiceLabel(voice) }));
    try {
      const audio = await requestSpeech({ text: VOICE_SAMPLE_TEXT, voice }, controller.signal);
      if (request !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(audio.blob);
      samples.set(voice, url);
      if (props.voice === voice) setCurrent({ voice, url });
      props.onStatus(t("voiceSample.ready"), "success");
    } catch (error) {
      if (controller.signal.aborted) return;
      reportError(props.onStatus, error, t("voiceSample.failed"));
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
    </div>
  );
}
