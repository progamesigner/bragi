import {
  requestVoiceSample,
  type SpeechAudio,
  type SpeechPurpose,
  type SpeechRequest,
} from "../speech";
import { requestCachedSpeech, SpeechCache, speechCache, speechCacheKey } from "../speech-cache";
import { openSpeechStream, PcmStreamPlayer, type SpeechPcmStream } from "../speech-stream";
import { playbackSettings, subscribePlaybackSettings } from "../store/preferences";
import { pcmDurationMs, pcmToWav } from "../wav";

export type AudioOwner = "main" | "review" | "sample";
export type BlockReason = "not-allowed" | "resume-timeout" | "suspended" | "interrupted";
export type PauseReason = "user" | "visibility" | "suspended" | "interrupted";
export type AudioPhase =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "blocked"
  | "interrupted"
  | "ended"
  | "error";
export type AudioSnapshot = {
  generation: number;
  owner?: AudioOwner;
  segmentKey?: string;
  cacheKey?: string;
  input?: Readonly<SpeechRequest>;
  rate: number;
  phase: AudioPhase;
  reason?: BlockReason | PauseReason;
  error?: unknown;
  transport: "none" | "pcm" | "wav";
  position: number;
  duration?: number;
  bufferedDuration: number;
  seekable: boolean;
  underflow: boolean;
  activeOutputs: number;
};
export type PlayInput = {
  owner: AudioOwner;
  segmentKey: string;
  input: SpeechRequest;
  rate?: number;
  captionsLabel?: string;
};
export type PreloadInput = {
  segmentKey: string;
  input: SpeechRequest;
  rate?: number;
  signal?: AbortSignal;
};
export type SpeechAdapter = {
  get(input: SpeechRequest): SpeechAudio | undefined;
  set(input: SpeechRequest, audio: SpeechAudio): void;
  request(input: SpeechRequest, signal: AbortSignal, purpose: SpeechPurpose): Promise<SpeechAudio>;
  stream(input: SpeechRequest, signal: AbortSignal): Promise<SpeechPcmStream>;
  revision?(): number;
};
export const cachedSpeechAdapter: SpeechAdapter = {
  get: (input) => speechCache.get(input),
  set: (input, audio) => speechCache.set(input, audio),
  request: (input, signal, purpose) => requestCachedSpeech(input, signal, fetch, purpose),
  stream: openSpeechStream,
  revision: () => speechCache.revision,
};
export type AudioControllerOptions = {
  speech?: SpeechAdapter;
  sampleSpeech?: SpeechAdapter;
  createAudio?: () => HTMLAudioElement;
  createContext?: () => AudioContext;
  urls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  document?: Document | null;
  settings?: () => { voice?: string; rate: number };
  subscribeSettings?: (listener: () => void) => () => void;
  timeoutMs?: number;
};
type Intent = {
  generation: number;
  abort: AbortController;
  input: SpeechRequest;
  speech: SpeechAdapter;
  revision?: number;
  reader?: SpeechPcmStream["reader"];
  chunks: Uint8Array[];
  bytes: number;
  sampleRate: number;
  asset?: SpeechAudio;
  eof: boolean;
  wanted: boolean;
  attempt: number;
  permitted: boolean;
  permission?: Promise<boolean>;
  player?: PcmStreamPlayer;
  offset: number;
  url?: string;
  cleanup?: () => void;
};

/** Settings affect readiness, while native WAV assets can be reused at different rates. */
export function playbackCacheKey(input: SpeechRequest, rate: number): string {
  return JSON.stringify([speechCacheKey(input), rate]);
}
function reasonFor(error: unknown): BlockReason {
  return error instanceof Error && error.name === "NotAllowedError" ? "not-allowed" : "suspended";
}
function pcmBytes(chunks: Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** One controller per app, created lazily so SSR never creates browser resources. */
export class AudioController {
  readonly #speech: SpeechAdapter;
  readonly #options: AudioControllerOptions;
  readonly #sampleSpeech: SpeechAdapter;
  readonly #urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly #document?: Document;
  readonly #listeners = new Set<(snapshot: AudioSnapshot) => void>();
  readonly #preloads = new Set<{
    key: string;
    segmentKey: string;
    request: Omit<PreloadInput, "signal">;
    abort: AbortController;
  }>();
  readonly #prepared = new Map<string, string>();
  #unsubscribeSettings?: () => void;
  #audio?: HTMLAudioElement;
  #context?: AudioContext;
  #silentUrl?: string;
  #priming = false;
  #intent?: Intent;
  #disposed = false;
  #progressTimer?: ReturnType<typeof setTimeout>;
  #state: AudioSnapshot = {
    generation: 0,
    rate: 1,
    phase: "idle",
    transport: "none",
    position: 0,
    bufferedDuration: 0,
    seekable: false,
    underflow: false,
    activeOutputs: 0,
  };

  constructor(options: AudioControllerOptions = {}) {
    this.#options = options;
    const samples = new SpeechCache(8);
    this.#sampleSpeech = options.sampleSpeech ??
      options.speech ?? {
        get: (input) => samples.get(input),
        set: (input, audio) => samples.set(input, audio),
        request: async (input, signal) => {
          const audio = await requestVoiceSample(input, signal);
          signal.throwIfAborted();
          samples.set(input, audio);
          return audio;
        },
        stream: openSpeechStream,
        revision: () => samples.revision,
      };
    this.#speech = options.speech ?? cachedSpeechAdapter;
    this.#urls = options.urls ?? URL;
    this.#document =
      options.document === null ? undefined : (options.document ?? globalThis.document);
    this.#document?.addEventListener("visibilitychange", this.#visibility);
    this.#unsubscribeSettings = (options.subscribeSettings ?? subscribePlaybackSettings)(() =>
      this.#settingsChanged(),
    );
  }

  get snapshot(): AudioSnapshot {
    const intent = this.#intent;
    const pcm = this.#state.transport === "pcm";
    return {
      ...this.#state,
      position: pcm
        ? (intent?.offset ?? 0) + (intent?.player?.position ?? 0)
        : (this.#audio?.currentTime ?? this.#state.position),
      underflow: pcm && Boolean(intent?.player?.underflow) && !intent?.eof,
      activeOutputs:
        Number(
          Boolean(pcm && intent?.player && intent.wanted && this.#context?.state === "running"),
        ) +
        Number(Boolean(this.#state.transport === "wav" && !this.#audio?.paused && !this.#priming)),
    };
  }

  subscribe(listener: (snapshot: AudioSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #publish(patch: Partial<AudioSnapshot> = {}): void {
    this.#state = { ...this.#state, ...patch };
    if (this.#state.phase !== "playing") {
      clearTimeout(this.#progressTimer);
      this.#progressTimer = undefined;
    } else if (!this.#progressTimer) {
      this.#progressTimer = setTimeout(() => {
        this.#progressTimer = undefined;
        this.#publish();
      }, 100);
    }
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  #settings(input: SpeechRequest, rate?: number): { input: SpeechRequest; rate: number } {
    const settings = (this.#options.settings ?? playbackSettings)();
    const effectiveRate = rate ?? settings.rate;
    if (!Number.isFinite(effectiveRate) || effectiveRate <= 0)
      throw new RangeError("Invalid playback rate");
    return {
      input: Object.freeze({ ...input, voice: input.voice ?? settings.voice }),
      rate: effectiveRate,
    };
  }

  isPrepared(request: Omit<PreloadInput, "signal">): boolean {
    const { input, rate } = this.#settings(request.input, request.rate);
    return (
      this.#prepared.get(request.segmentKey) === playbackCacheKey(input, rate) &&
      Boolean(this.#speech.get(input))
    );
  }

  invalidatePreloads(): void {
    this.#prepared.clear();
    for (const preload of this.#preloads) preload.abort.abort();
    this.#preloads.clear();
    this.#publish();
  }

  /**
   * Preloads made with the old settings are cancelled. One already made with the new settings, for
   * example by a screen reacting to the same change first, is kept rather than synthesized twice.
   */
  #settingsChanged(): void {
    this.#prepared.clear();
    for (const preload of this.#preloads) {
      const { input, rate } = this.#settings(preload.request.input, preload.request.rate);
      if (playbackCacheKey(input, rate) === preload.key) continue;
      preload.abort.abort();
      this.#preloads.delete(preload);
    }
    this.#publish();
  }

  async preload(request: PreloadInput): Promise<void> {
    if (this.#disposed) throw new Error("Audio controller is disposed");
    request.signal?.throwIfAborted();
    const { input, rate } = this.#settings(request.input, request.rate);
    const key = playbackCacheKey(input, rate);
    const pending = {
      key,
      segmentKey: request.segmentKey,
      request: { segmentKey: request.segmentKey, input: request.input, rate: request.rate },
      abort: new AbortController(),
    };
    const cancel = () => pending.abort.abort();
    request.signal?.addEventListener("abort", cancel, { once: true });
    this.#preloads.add(pending);
    try {
      const speech = this.#speech.request(input, pending.abort.signal, "prefetch");
      // A new version for this segment supersedes its old preload subscriptions. They leave only
      // after this one joined, so a version that differs only in rate keeps the same synthesis.
      for (const old of this.#preloads) {
        if (old.segmentKey === request.segmentKey && old.key !== key) old.abort.abort();
      }
      await speech;
      pending.abort.signal.throwIfAborted();
      this.#prepared.set(request.segmentKey, key);
      this.#publish();
    } finally {
      request.signal?.removeEventListener("abort", cancel);
      this.#preloads.delete(pending);
    }
  }

  #resources(): { audio: HTMLAudioElement; context: AudioContext; silentUrl: string } {
    if (!this.#audio) this.#audio = (this.#options.createAudio ?? (() => new Audio()))();
    if (!this.#context) {
      this.#context = (
        this.#options.createContext ?? (() => new AudioContext({ sampleRate: 24_000 }))
      )();
      this.#context.addEventListener("statechange", this.#contextChanged);
    }
    if (!this.#silentUrl)
      this.#silentUrl = this.#urls.createObjectURL(
        new Blob([pcmToWav(new Uint8Array(4800))], { type: "audio/wav" }),
      );
    return { audio: this.#audio, context: this.#context, silentUrl: this.#silentUrl };
  }

  #current(intent: Intent): boolean {
    return this.#intent === intent && !intent.abort.signal.aborted;
  }
  #attemptCurrent(intent: Intent, attempt: number): boolean {
    return this.#current(intent) && intent.attempt === attempt && intent.wanted;
  }

  #bounded(promise: Promise<unknown>, timeoutReason: BlockReason): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutReason), this.#options.timeoutMs ?? 1500);
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(reasonFor(error));
        },
      );
    });
  }

  /** Both native calls happen synchronously in the caller's trusted gesture. */
  #unlock(intent: Intent, prime: boolean): Promise<boolean> {
    const { audio, context, silentUrl } = this.#resources();
    const attempt = intent.attempt;
    let resumed: Promise<unknown>;
    try {
      resumed = context.resume();
    } catch (error) {
      resumed = Promise.reject(error);
    }
    const permissions = [
      this.#bounded(resumed, "resume-timeout").then(() => {
        if (context.state !== "running")
          throw context.state === ("interrupted" as AudioContextState)
            ? "interrupted"
            : "suspended";
      }),
    ];
    if (prime) {
      this.#priming = true;
      audio.src = silentUrl;
      audio.loop = true;
      audio.playbackRate = 1;
      let primed: Promise<unknown>;
      try {
        primed = audio.play();
      } catch (error) {
        primed = Promise.reject(error);
      }
      permissions.push(this.#bounded(primed, "resume-timeout"));
    }
    return Promise.all(permissions).then(
      () => {
        if (!this.#attemptCurrent(intent, attempt)) return false;
        intent.permitted = true;
        return true;
      },
      (reason: BlockReason) => {
        if (this.#attemptCurrent(intent, attempt)) this.#block(intent, reason);
        return false;
      },
    );
  }

  async play(request: PlayInput): Promise<void> {
    if (this.#disposed) throw new Error("Audio controller is disposed");
    const settings = this.#settings(request.input, request.rate);
    this.#clearIntent(); // Claim and stop previous output before the first await.
    const speech = request.owner === "sample" ? this.#sampleSpeech : this.#speech;
    const intent: Intent = {
      generation: this.#state.generation + 1,
      abort: new AbortController(),
      input: settings.input,
      speech,
      revision: speech.revision?.(),
      chunks: [],
      bytes: 0,
      sampleRate: 24_000,
      eof: false,
      wanted: true,
      attempt: 0,
      permitted: false,
      offset: 0,
    };
    this.#intent = intent;
    this.#state = {
      generation: intent.generation,
      owner: request.owner,
      segmentKey: request.segmentKey,
      cacheKey: playbackCacheKey(settings.input, settings.rate),
      input: settings.input,
      rate: settings.rate,
      phase: "loading",
      transport: "none",
      position: 0,
      bufferedDuration: 0,
      seekable: false,
      underflow: false,
      activeOutputs: 0,
    };
    try {
      const permission = this.#unlock(intent, true);
      // Captions live on the one native element; custom controls and visible transcripts live in UI.
      const audio = this.#audio;
      if (audio && this.#document?.createElement) {
        audio.replaceChildren();
        const track = this.#document.createElement("track");
        track.kind = "captions";
        track.label = request.captionsLabel ?? "";
        track.default = true;
        track.src = `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 24:00:00.000\n${intent.input.text.replaceAll("-->", "→")}`)}`;
        audio.append(track);
      }
      intent.permission = permission;
      this.#publish();
      const cached = intent.speech.get(intent.input);
      const pending = [...this.#preloads].some((preload) => preload.key === this.#state.cacheKey);
      if (cached || request.owner !== "main" || settings.rate !== 1 || pending) {
        intent.asset =
          cached ??
          (await intent.speech.request(
            intent.input,
            intent.abort.signal,
            request.owner === "review" || request.owner === "sample" ? "preview" : "playback",
          ));
        if (!this.#current(intent)) return;
        intent.eof = true;
        await intent.permission;
        if (!this.#current(intent)) return;
        this.#loadWav(intent);
        if (intent.wanted && intent.permitted) await this.#playWav(intent);
      } else {
        await permission;
        if (!this.#current(intent)) return;
        const stream = await intent.speech.stream(intent.input, intent.abort.signal);
        if (!this.#current(intent)) {
          void stream.reader.cancel().catch(() => undefined);
          return;
        }
        intent.reader = stream.reader;
        intent.sampleRate = stream.sampleRate;
        this.#stopPrime();
        this.#publish({ transport: "pcm" });
        while (this.#current(intent)) {
          const result = await stream.reader.read();
          if (!this.#current(intent)) return;
          if (result.done) break;
          const chunk = result.value.slice();
          intent.chunks.push(chunk);
          intent.bytes += chunk.byteLength;
          if (intent.wanted && intent.permitted) {
            if (intent.player) intent.player.append(chunk);
            else this.#startPcm(intent);
          }
          this.#publish({ bufferedDuration: intent.bytes / 2 / intent.sampleRate });
        }
        if (!this.#current(intent)) return;
        const pcm = pcmBytes(intent.chunks, intent.bytes);
        if (pcm.byteLength === 0 || pcm.byteLength % 2) throw new Error("Invalid PCM stream");
        intent.asset = {
          blob: new Blob([pcmToWav(pcm, intent.sampleRate)], { type: "audio/wav" }),
          durationMs: pcmDurationMs(pcm.byteLength, intent.sampleRate),
        };
        intent.eof = true;
        if (intent.speech.revision?.() === intent.revision)
          intent.speech.set(intent.input, intent.asset);
        this.#loadWav(intent); // Metadata only: PCM keeps playing until an explicit seek.
        if (intent.player) this.#waitForPcmEnd(intent, intent.player);
        else if (intent.wanted && intent.permitted) this.#startPcm(intent);
      }
    } catch (error) {
      if (!this.#current(intent)) return;
      intent.wanted = false;
      intent.attempt++;
      this.#halt(intent);
      intent.abort.abort();
      void intent.reader?.cancel().catch(() => undefined);
      this.#publish({ phase: "error", reason: undefined, error });
    }
  }

  #stopPrime(): void {
    if (!this.#priming) return;
    this.#priming = false;
    this.#audio?.pause();
    if (this.#audio) this.#audio.loop = false;
  }

  #loadWav(intent: Intent): void {
    if (!intent.asset || intent.url) return;
    this.#stopPrime();
    const audio = this.#audio;
    if (!audio) return;
    intent.url = this.#urls.createObjectURL(intent.asset.blob);
    if (this.#state.segmentKey && this.#state.cacheKey)
      this.#prepared.set(this.#state.segmentKey, this.#state.cacheKey);
    const metadata = () => {
      if (!this.#current(intent) || audio.src !== intent.url) return;
      this.#publish({
        seekable: Number.isFinite(audio.duration) && audio.duration > 0,
        duration: audio.duration,
      });
    };
    const ended = () => {
      if (
        this.#current(intent) &&
        this.#state.transport === "wav" &&
        audio.ended &&
        this.#state.phase === "playing"
      )
        this.#end(intent);
    };
    const paused = () => {
      if (
        this.#current(intent) &&
        this.#state.transport === "wav" &&
        audio.paused &&
        !audio.ended &&
        this.#state.phase === "playing"
      )
        this.#interrupt("interrupted");
    };
    const progress = () => {
      if (this.#current(intent)) this.#publish();
    };
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("ended", ended);
    audio.addEventListener("pause", paused);
    audio.addEventListener("timeupdate", progress);
    intent.cleanup = () => {
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("timeupdate", progress);
    };
    audio.src = intent.url;
    audio.load();
    audio.playbackRate = this.#state.rate;
    audio.preservesPitch = true;
    this.#publish({
      transport: this.#state.transport === "none" ? "wav" : this.#state.transport,
      duration: intent.asset.durationMs === undefined ? undefined : intent.asset.durationMs / 1000,
    });
  }

  async #playWav(intent: Intent): Promise<void> {
    if (!this.#current(intent) || !intent.wanted || !intent.asset) return;
    const attempt = intent.attempt;
    const audio = this.#audio;
    if (!audio) return;
    this.#stopPrime();
    this.#publish({ transport: "wav" });
    audio.playbackRate = this.#state.rate; // load() may reset this in Chromium and WebKit.
    audio.preservesPitch = true;
    try {
      await this.#bounded(audio.play(), "resume-timeout");
      if (this.#attemptCurrent(intent, attempt))
        this.#publish({ phase: "playing", reason: undefined });
    } catch (reason) {
      if (this.#attemptCurrent(intent, attempt))
        this.#block(
          intent,
          typeof reason === "string" ? (reason as BlockReason) : reasonFor(reason),
        );
    }
  }

  #startPcm(intent: Intent): void {
    if (!this.#current(intent) || !intent.wanted || !intent.permitted || intent.player) return;
    const context = this.#context;
    if (context?.state !== "running") {
      this.#block(intent, "suspended");
      return;
    }
    const bytes = pcmBytes(intent.chunks, intent.bytes);
    const offset = Math.floor(intent.offset * intent.sampleRate) * 2;
    if (bytes.byteLength <= offset) {
      if (intent.eof) this.#end(intent);
      return;
    }
    this.#stopPrime();
    const player = new PcmStreamPlayer(context, intent.sampleRate, {
      started: () => {
        if (this.#current(intent) && intent.player === player && intent.wanted)
          this.#publish({ phase: "playing", reason: undefined });
      },
    });
    intent.player = player;
    player.append(bytes.subarray(offset));
    if (intent.eof) this.#waitForPcmEnd(intent, player);
  }

  #waitForPcmEnd(intent: Intent, player: PcmStreamPlayer): void {
    void player.finish().then(() => {
      if (
        this.#current(intent) &&
        intent.player === player &&
        intent.wanted &&
        this.#state.transport === "pcm"
      )
        this.#end(intent);
    });
  }

  #end(intent: Intent): void {
    intent.offset += intent.player?.position ?? 0;
    intent.player?.stop();
    intent.player = undefined;
    intent.wanted = false;
    intent.attempt++;
    this.#publish({ phase: "ended", reason: undefined });
  }

  #halt(intent: Intent): void {
    if (this.#state.transport === "pcm") intent.offset += intent.player?.position ?? 0;
    intent.player?.stop();
    intent.player = undefined;
    this.#stopPrime();
    this.#audio?.pause();
  }

  #block(intent: Intent, reason: BlockReason): void {
    intent.wanted = false;
    intent.permitted = false;
    intent.attempt++;
    this.#publish({ phase: "blocked", reason });
    this.#halt(intent);
    this.#publish();
  }

  pause(owner: AudioOwner): void {
    const intent = this.#intent;
    if (
      !intent ||
      owner !== this.#state.owner ||
      !["playing", "loading", "blocked", "interrupted"].includes(this.#state.phase)
    )
      return;
    intent.wanted = false;
    intent.attempt++;
    this.#publish({ phase: "paused", reason: "user" });
    this.#halt(intent);
    if (this.#state.transport === "pcm") void this.#context?.suspend().catch(() => undefined);
    this.#publish();
  }

  async resume(owner: AudioOwner): Promise<void> {
    const intent = this.#intent;
    if (
      !intent ||
      owner !== this.#state.owner ||
      !["paused", "blocked", "interrupted", "ended"].includes(this.#state.phase)
    )
      return;
    intent.wanted = true;
    intent.attempt++;
    intent.permitted = false;
    if (this.#state.phase === "ended") {
      intent.offset = 0;
      if (this.#audio) this.#audio.currentTime = 0;
    }
    const wav = this.#state.transport === "wav" && Boolean(intent.asset);
    const permission = this.#unlock(intent, !wav && !intent.url);
    intent.permission = permission;
    const attempt = intent.attempt;
    this.#publish({ phase: "loading", reason: undefined });
    // Native content play also runs before await, so WAV recovery uses this gesture.
    const content = wav ? this.#playWav(intent) : undefined;
    if (!(await permission) || !this.#attemptCurrent(intent, attempt)) return;
    if (wav) await content;
    else if (this.#state.transport === "pcm") this.#startPcm(intent);
    else if (intent.asset) {
      this.#loadWav(intent);
      await this.#playWav(intent);
    }
  }

  async seek(owner: AudioOwner, seconds: number): Promise<void> {
    const intent = this.#intent;
    if (
      !intent ||
      owner !== this.#state.owner ||
      !this.#state.seekable ||
      !Number.isFinite(seconds)
    )
      return;
    const switched = this.#state.transport === "pcm";
    const shouldStart =
      switched &&
      intent.wanted &&
      intent.permitted &&
      ["playing", "loading"].includes(this.#state.phase);
    if (switched) {
      intent.player?.stop();
      intent.player = undefined;
      this.#publish({ transport: "wav" });
    }
    if (!this.#audio) return;
    this.#audio.currentTime = Math.max(0, Math.min(this.#state.duration ?? seconds, seconds));
    if (this.#state.phase === "ended") this.#publish({ phase: "paused", reason: "user" });
    if (shouldStart) await this.#playWav(intent);
    this.#publish();
  }

  #interrupt(reason: PauseReason): void {
    const intent = this.#intent;
    if (!intent?.wanted || !["playing", "loading"].includes(this.#state.phase)) return;
    intent.wanted = false;
    intent.attempt++;
    intent.permitted = false;
    this.#publish({ phase: "interrupted", reason });
    this.#halt(intent);
    this.#publish();
  }
  #contextChanged = (): void => {
    if (
      this.#context?.state !== "running" &&
      (this.#state.transport === "pcm" ||
        (this.#state.transport === "none" && this.#intent?.permitted))
    )
      this.#interrupt(
        this.#context?.state === ("interrupted" as AudioContextState) ? "interrupted" : "suspended",
      );
  };
  #visibility = (): void => {
    if (this.#document?.visibilityState === "hidden") this.#interrupt("visibility");
    else this.#contextChanged();
  };

  #clearIntent(): void {
    const intent = this.#intent;
    if (intent) {
      intent.wanted = false;
      intent.attempt++;
      intent.cleanup?.();
      this.#halt(intent);
      intent.abort.abort();
      void intent.reader?.cancel().catch(() => undefined);
      if (intent.url) this.#urls.revokeObjectURL(intent.url);
    }
    this.#intent = undefined;
    this.#stopPrime();
    if (this.#audio) {
      this.#audio.pause();
      this.#audio.removeAttribute("src");
      this.#audio.load();
    }
  }

  stop(owner: AudioOwner): void {
    if (owner !== this.#state.owner) return;
    this.#clearIntent();
    this.#state = {
      generation: this.#state.generation + 1,
      phase: "idle",
      rate: 1,
      transport: "none",
      position: 0,
      bufferedDuration: 0,
      seekable: false,
      underflow: false,
      activeOutputs: 0,
    };
    this.#publish();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#clearIntent();
    this.invalidatePreloads();
    this.#disposed = true;
    this.#unsubscribeSettings?.();
    this.#document?.removeEventListener("visibilitychange", this.#visibility);
    this.#context?.removeEventListener("statechange", this.#contextChanged);
    void this.#context?.close().catch(() => undefined);
    if (this.#silentUrl) this.#urls.revokeObjectURL(this.#silentUrl);
    this.#state = {
      generation: this.#state.generation + 1,
      phase: "idle",
      rate: 1,
      transport: "none",
      position: 0,
      bufferedDuration: 0,
      seekable: false,
      underflow: false,
      activeOutputs: 0,
    };
    this.#publish();
    this.#listeners.clear();
  }
}

let singleton: AudioController | undefined;
export function getAudioController(): AudioController {
  singleton ??= new AudioController();
  return singleton;
}
