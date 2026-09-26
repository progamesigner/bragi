import "server-only";
import { z } from "zod";
import type { TtsRequest } from "../schemas";
import { pcmDurationMs } from "../wav";
import { requiredEnv } from "./config";
import { resolveVoice } from "./voices";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MAX_DURATION_MS = 60_000;
const MAX_PCM_BYTES = (SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8) * MAX_DURATION_MS) / 1000;

const interactionSchema = z.object({
  steps: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z
            .object({
              type: z.string(),
              data: z.string().optional(),
              mime_type: z.string().optional(),
              sample_rate: z.number().int().positive().optional(),
              channels: z.number().int().positive().optional(),
            })
            .passthrough(),
        )
        .optional(),
    }),
  ),
});

export type SpeechFailureKind =
  | "rate-limited"
  | "rejected"
  | "unavailable"
  | "invalid-response"
  | "too-long";

export class SpeechError extends Error {
  constructor(
    readonly kind: SpeechFailureKind,
    message: string,
    readonly retryAfter?: string,
    readonly canRetry = false,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";

export function speechModel(): string {
  return process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
}

/**
 * Gemini 3.8 TTS reads text strictly as a verbatim transcript, so delivery directions travel
 * separately as turn-level speech metadata instead of being embedded in a prompt.
 */
export function speechInput(input: TtsRequest) {
  const style = [input.toneHint, input.genreHint ? `Genre: ${input.genreHint}` : undefined]
    .filter(Boolean)
    .join("; ");
  return [
    {
      type: "user_input",
      content: [
        {
          type: "text",
          text: input.text,
          annotations: [{ type: "speech_metadata", style: style || "Natural tabletop narration" }],
        },
      ],
    },
  ];
}

/** Raw 24 kHz mono PCM keeps unary and streaming responses on the same validation path. */
export const SPEECH_RESPONSE_FORMAT = {
  type: "audio",
  mime_type: "audio/l16",
  sample_rate: SAMPLE_RATE,
} as const;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1)
    throw new SpeechError(
      "invalid-response",
      "Gemini returned invalid audio data",
      undefined,
      true,
    );
  const buffer = Buffer.from(value, "base64");
  if (buffer.byteLength === 0)
    throw new SpeechError("invalid-response", "Gemini returned empty audio", undefined, true);
  return Uint8Array.from(buffer);
}

function validateAudioMetadata(audio: {
  mime_type?: string;
  sample_rate?: number;
  channels?: number;
}): void {
  const [mediaType, ...parameters] = audio.mime_type?.toLowerCase().split(";") ?? [];
  if (mediaType?.trim() && mediaType.trim() !== "audio/l16")
    throw new SpeechError("invalid-response", "Gemini returned an unsupported audio format");
  const mimeRate = parameters
    .map((parameter) => parameter.trim().match(/^rate=(\d+)$/)?.[1])
    .find(Boolean);
  const sampleRate = audio.sample_rate ?? (mimeRate ? Number(mimeRate) : undefined);
  if (sampleRate && sampleRate !== SAMPLE_RATE)
    throw new SpeechError("invalid-response", "Gemini returned an unsupported sample rate");
  if (audio.channels && audio.channels !== CHANNELS)
    throw new SpeechError("invalid-response", "Gemini returned unsupported audio channels");
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SpeechError("invalid-response", "Gemini returned invalid JSON", undefined, true);
  }
}

async function requestSpeech(
  input: TtsRequest,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": requiredEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify({
        model: speechModel(),
        store: false,
        input: speechInput(input),
        response_format: SPEECH_RESPONSE_FORMAT,
        generation_config: {
          speech_config: [{ voice: resolveVoice(input.voice) }],
        },
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof SpeechError) throw error;
    throw new SpeechError("unavailable", "Gemini speech request failed", undefined, true);
  }

  if (response.status === 429)
    throw new SpeechError(
      "rate-limited",
      "Gemini speech rate limit was reached",
      response.headers.get("retry-after") ?? undefined,
    );
  if ([400, 422].includes(response.status))
    throw new SpeechError("rejected", `Gemini rejected the speech request (${response.status})`);
  if (!response.ok)
    throw new SpeechError(
      "unavailable",
      `Gemini speech request failed (${response.status})`,
      undefined,
      response.status >= 500,
    );

  const interaction = interactionSchema.safeParse(await responseJson(response));
  if (!interaction.success)
    throw new SpeechError("invalid-response", "Gemini speech response is invalid", undefined, true);
  const audio = interaction.data.steps
    .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
    .filter((content) => content.type === "audio")
    .at(-1);
  if (!audio?.data)
    throw new SpeechError("invalid-response", "Gemini returned no audio", undefined, true);
  validateAudioMetadata(audio);

  const pcm = decodeBase64(audio.data);
  if (pcm.byteLength % 2 !== 0)
    throw new SpeechError(
      "invalid-response",
      "Gemini returned incomplete PCM audio",
      undefined,
      true,
    );
  if (pcm.byteLength > MAX_PCM_BYTES)
    throw new SpeechError("too-long", "Generated speech exceeds 60 seconds");
  return pcm;
}

function retryDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 75 + Math.random() * 100));
}

export async function synthesizeSpeech(
  input: TtsRequest,
  requestSignal?: AbortSignal,
): Promise<{ pcm: Uint8Array<ArrayBuffer>; durationMs: number }> {
  const deadline = Date.now() + 55_000;
  let lastError: SpeechError | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const timeout = AbortSignal.timeout(remaining);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    try {
      const pcm = await requestSpeech(input, signal);
      return { pcm, durationMs: pcmDurationMs(pcm.byteLength) };
    } catch (error) {
      if (!(error instanceof SpeechError)) throw error;
      lastError = error;
      if (!error.canRetry || attempt === 1 || deadline - Date.now() < 250) throw error;
      await retryDelay();
    }
  }
  throw lastError ?? new SpeechError("unavailable", "Gemini speech request timed out");
}
