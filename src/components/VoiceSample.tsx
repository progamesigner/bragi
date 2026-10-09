import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { networkErrorMessage } from "~/lib/network";
import { requestSpeech } from "~/lib/speech";
import type { StatusReporter } from "~/lib/status";
import { VOICE_SAMPLE_TEXT, voiceLabel } from "~/lib/voices";

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
    props.onStatus(`正在產生 ${voiceLabel(voice)} 的試聽…`);
    try {
      const audio = await requestSpeech({ text: VOICE_SAMPLE_TEXT, voice }, controller.signal);
      if (request !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(audio.blob);
      samples.set(voice, url);
      if (props.voice === voice) setCurrent({ voice, url });
      props.onStatus("聲音試聽已準備完成，請按播放", "success");
    } catch (error) {
      if (controller.signal.aborted) return;
      props.onStatus(networkErrorMessage(error, "無法產生聲音試聽"), "error");
    } finally {
      if (request === controller) setBusy(false);
    }
  }

  return (
    <div class="voice-sample">
      <button
        type="button"
        class="small secondary"
        disabled={busy() || !props.voice}
        onClick={generate}
      >
        {busy() ? "產生中…" : "試聽這個聲音"}
      </button>
      <Show when={current()?.voice === props.voice ? current() : undefined}>
        {(sample) => (
          <audio controls preload="metadata" src={sample().url} aria-label="聲音試聽">
            <track
              kind="captions"
              src={`data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 01:00.000\n${VOICE_SAMPLE_TEXT}`)}`}
              label="試聽句子"
              default
            />
          </audio>
        )}
      </Show>
    </div>
  );
}
