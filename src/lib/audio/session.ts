import { createSignal, onCleanup, onMount } from "solid-js";
import { type AudioOwner, type AudioSnapshot, getAudioController } from "./controller";

/** A screen observes only its own intent. Switching owners stops the prior screen's output. */
export function createAudioSession(
  owner: AudioOwner,
  changed?: (snapshot: AudioSnapshot) => void,
  segmentKey?: () => string,
) {
  const [snapshot, setSnapshot] = createSignal<AudioSnapshot>({
    generation: 0,
    rate: 1,
    phase: "idle",
    transport: "none",
    position: 0,
    bufferedDuration: 0,
    seekable: false,
    underflow: false,
    activeOutputs: 0,
  });
  onMount(() => {
    const controller = getAudioController();
    const unsubscribe = controller.subscribe((value) => {
      const owned =
        value.owner === owner
          ? value
          : {
              ...value,
              owner: undefined,
              input: undefined,
              phase: "idle" as const,
              position: 0,
              duration: undefined,
              seekable: false,
              error: undefined,
              reason: undefined,
            };
      setSnapshot(owned);
      changed?.(owned);
    });
    onCleanup(() => {
      unsubscribe();
      if (!segmentKey || controller.snapshot.segmentKey === segmentKey()) controller.stop(owner);
    });
  });
  return { snapshot, controller: getAudioController };
}

export function audioTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

/** How far a seek slider's track is filled, as the `--position` its styles read. */
export function seekPosition(snapshot: Pick<AudioSnapshot, "position" | "duration">): string {
  const { position, duration } = snapshot;
  return `${duration ? Math.min(100, (position / duration) * 100) : 0}%`;
}
