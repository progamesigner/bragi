# Bragi

Mobile-first tabletop narration assistant. Bragi uploads a tabletop script or card image to Gemini, extracts structured narration segments, and prepares them for reviewed, step-by-step playback.

## Local setup

1. Use Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and fill in secrets. Generate `BRAGI_SESSION_SECRET` with at least 32 random bytes.
3. Add the Base32 `BRAGI_TOTP_SECRET` to an authenticator app using an offline `otpauth://` QR-code workflow.
4. Run `npm run dev`.

The home page signs in with TOTP, captures or selects an image, uploads it through Bragi to Gemini Files, and runs live OCR with `gemini-3.8-flash`. The browser normalizes EXIF orientation, limits the longest edge to 2,400 pixels, and compresses supported images below the 4 MB application limit before upload. Gemini may retain uploaded files for up to 48 hours.

OCR output opens as an editable review draft. Every segment supports text and tone edits, cursor-position splitting, merging with the next segment, insertion, and deletion. These edits remain in memory and are not persisted across page reloads.

After review, playback prepares one segment at a time. Each prepared segment requires an explicit play action, and playback stops when the segment ends until the user chooses to replay it or continue. Once a segment starts playing, Bragi prepares at most one following segment in the background. Speech previews and playback share a bounded in-memory cache of three entries or 9 MB; changing the image or signing out clears it. Returning to review preserves the current draft, while leaving playback cancels its active speech requests and releases generated audio URLs.

Progress, success, and error notices use distinct accessible live-region semantics, and API failures retain their request ID for troubleshooting. Keyboard focus follows the review and playback views, invalid empty segments include field guidance, and all controls expose a visible focus indicator. The upload screen explains which processing stays on-device, which data is sent to Gemini, and what Bragi does not persist.

JPEG, PNG, WebP, HEIC, and HEIF sources up to 25 MB are accepted. When a browser cannot decode HEIC or HEIF, an original file already below 4 MB can still be sent directly to Gemini; larger files require conversion or a new capture.

## Verification

```sh
npm run check
npm test
npm run build
npm run preview
```

`POST /api/uploads`, `/api/ocr`, and `/api/tts` require the signed `__Host-bragi-session` cookie and an exact same-origin `Origin` header. The JWT and persistent cookie expire together after 90 days. `GET /api/session` restores the signed-in interface without exposing the token, while `DELETE /api/session` expires it and clears the active browser workspace.

`/api/ocr` verifies the untrusted upload receipt against Gemini Files metadata before sending the file URI to the Interactions API. It uses structured output, high image resolution, and stateless processing.

`/api/tts` uses `gemini-3.1-flash-tts-preview` with the server-configured voice. It requests audio using the model's native format, validates the returned 24 kHz mono PCM and limits it to 60 seconds, wraps it in WAV, and retries one transient or missing-audio response. Review segments expose manual previews through native audio controls; generated object URLs are revoked when the text changes or the component is removed.

JSON errors use `{ error: { code, message, requestId, retryable } }`; the same request ID is exposed through `X-Request-Id` on every API response.
