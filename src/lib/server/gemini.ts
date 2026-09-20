import "server-only";
import { z } from "zod";
import { type OcrResponse, ocrResponseSchema } from "../schemas";
import { requiredEnv } from "./config";

const API_ORIGIN = "https://generativelanguage.googleapis.com";
const fileNameSchema = z.string().regex(/^files\/[A-Za-z0-9_-]+$/);
const uploadReceiptSchema = z.object({
  file: z.object({ name: fileNameSchema }),
});
const geminiFileSchema = z.object({
  name: fileNameSchema,
  mimeType: z.string(),
  sizeBytes: z.string().regex(/^\d+$/),
  uri: z.string().url(),
  state: z.enum(["PROCESSING", "ACTIVE", "FAILED"]),
});

const modelTextSchema = z.object({
  steps: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
        .optional(),
    }),
  ),
});

export type GeminiFailureKind =
  | "invalid-file"
  | "processing"
  | "rate-limited"
  | "rejected"
  | "unavailable"
  | "invalid-response";

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiFailureKind,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

function apiHeaders(): HeadersInit {
  return { "x-goog-api-key": requiredEnv("GEMINI_API_KEY") };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GeminiError("invalid-response", "Gemini returned invalid JSON");
  }
}

function assertFileUri(uri: string): void {
  const url = new URL(uri);
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com")
    throw new GeminiError("invalid-file", "Gemini returned an invalid file URI");
}

export async function resolveGeminiFile(
  receipt: unknown,
  expected: { mimeType: string; sizeBytes: number },
): Promise<{ uri: string; mimeType: string }> {
  const parsedReceipt = uploadReceiptSchema.safeParse(receipt);
  if (!parsedReceipt.success) throw new GeminiError("invalid-file", "Upload receipt is invalid");

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v1beta/${parsedReceipt.data.file.name}`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GeminiError("unavailable", "Gemini Files API is unavailable");
  }
  if (response.status === 429)
    throw new GeminiError(
      "rate-limited",
      "Gemini rate limit was reached",
      response.headers.get("retry-after") ?? undefined,
    );
  if (!response.ok) {
    const kind = response.status >= 500 ? "unavailable" : "invalid-file";
    throw new GeminiError(kind, `Gemini file lookup failed (${response.status})`);
  }

  const file = geminiFileSchema.safeParse(await parseJson(response));
  if (!file.success) throw new GeminiError("invalid-response", "Gemini file metadata is invalid");
  if (file.data.state === "PROCESSING")
    throw new GeminiError("processing", "Uploaded image is still processing");
  if (file.data.state !== "ACTIVE")
    throw new GeminiError("invalid-file", "Uploaded image is not available");
  if (
    file.data.name !== parsedReceipt.data.file.name ||
    file.data.mimeType !== expected.mimeType ||
    Number(file.data.sizeBytes) !== expected.sizeBytes
  )
    throw new GeminiError("invalid-file", "Uploaded image metadata does not match");
  assertFileUri(file.data.uri);
  return { uri: file.data.uri, mimeType: file.data.mimeType };
}

const ocrJsonSchema = {
  type: "object",
  properties: {
    detectedLanguage: {
      type: "string",
      maxLength: 35,
      description: "BCP 47 language tag for the primary recognized language",
    },
    segments: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          id: { type: "string", maxLength: 64 },
          text: {
            type: "string",
            minLength: 1,
            maxLength: 400,
            description: "Exact recognized text for this narration segment",
          },
          suggestedToneHint: {
            type: "string",
            maxLength: 120,
            description: "Short delivery direction in the same language as the text",
          },
        },
        required: ["id", "text", "suggestedToneHint"],
        additionalProperties: false,
      },
    },
  },
  required: ["detectedLanguage", "segments"],
  additionalProperties: false,
} as const;

function ocrPrompt(genreHint?: string): string {
  return [
    "Transcribe all readable tabletop game narration or card text in the image.",
    "Preserve the original language, wording, punctuation, and reading order.",
    "Split the transcription into natural narration segments without summarizing or inventing text.",
    "Keep every segment at or below 400 characters so it can be narrated independently.",
    "Use stable sequential IDs such as segment-1. Suggest a concise speaking tone for each segment.",
    "Ignore decorative text that is clearly not part of the readable game content.",
    genreHint ? `The user describes the game genre or scene as: ${genreHint}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function recognizeImage(
  file: { uri: string; mimeType: string },
  genreHint?: string,
): Promise<OcrResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v1beta/interactions`, {
      method: "POST",
      headers: { ...apiHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.GEMINI_OCR_MODEL?.trim() || "gemini-3.8-flash",
        store: false,
        input: [
          { type: "text", text: ocrPrompt(genreHint) },
          { type: "image", uri: file.uri, mime_type: file.mimeType, resolution: "high" },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: ocrJsonSchema,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new GeminiError("unavailable", "Gemini OCR is unavailable");
  }

  if (response.status === 429)
    throw new GeminiError(
      "rate-limited",
      "Gemini rate limit was reached",
      response.headers.get("retry-after") ?? undefined,
    );
  if ([400, 403].includes(response.status))
    throw new GeminiError("rejected", `Gemini rejected the OCR request (${response.status})`);
  if (!response.ok) throw new GeminiError("unavailable", `Gemini OCR failed (${response.status})`);

  const interaction = modelTextSchema.safeParse(await parseJson(response));
  if (!interaction.success)
    throw new GeminiError("invalid-response", "Gemini OCR response is invalid");
  const outputText = interaction.data.steps
    .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
    .filter((content) => content.type === "text")
    .at(-1)?.text;
  if (!outputText) throw new GeminiError("invalid-response", "Gemini OCR returned no text");

  try {
    return ocrResponseSchema.parse(JSON.parse(outputText));
  } catch {
    throw new GeminiError("invalid-response", "Gemini OCR output did not match its schema");
  }
}
