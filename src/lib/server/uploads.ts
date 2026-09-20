import "server-only";
import { SignJWT } from "jose";
import { requiredEnv } from "./config";

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
export const MAX_UPLOAD_BYTES = 20_000_000;

function uploadKey(): Uint8Array {
  return new TextEncoder().encode(requiredEnv("BRAGI_SESSION_SECRET"));
}

export async function createGeminiUpload(mimeType: string, sizeBytes: number) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(requiredEnv("GEMINI_API_KEY"))}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(sizeBytes),
        "x-goog-upload-header-content-type": mimeType,
      },
      body: JSON.stringify({ file: { display_name: `bragi-${crypto.randomUUID()}` } }),
    },
  );
  if (!response.ok) throw new Error(`Gemini upload session failed (${response.status})`);
  const url = response.headers.get("x-goog-upload-url");
  if (!url) throw new Error("Gemini response omitted x-goog-upload-url");

  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const uploadId = await new SignJWT({ provider: "gemini", mimeType, sizeBytes })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("bragi-upload")
    .setAudience("bragi-ocr")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setJti(crypto.randomUUID())
    .sign(uploadKey());

  return {
    uploadId,
    target: {
      url,
      method: "POST" as const,
      headers: {
        "content-type": mimeType,
        "x-goog-upload-offset": "0",
        "x-goog-upload-command": "upload, finalize",
      },
    },
    expiresAt: expiresAt.toISOString(),
  };
}
