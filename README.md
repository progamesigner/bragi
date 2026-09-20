# Bragi

Mobile-first tabletop narration assistant. Bragi uploads a tabletop script or card image to Gemini, extracts structured narration segments, and prepares them for reviewed, step-by-step playback.

## Local setup

1. Use Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and fill in secrets. Generate `BRAGI_SESSION_SECRET` with at least 32 random bytes.
3. Add the Base32 `BRAGI_TOTP_SECRET` to an authenticator app using an offline `otpauth://` QR-code workflow.
4. Run `npm run dev`.

The home page signs in with TOTP, captures or selects an image, uploads it through Bragi to Gemini Files, and runs live OCR with `gemini-3.8-flash`. The browser normalizes EXIF orientation, limits the longest edge to 2,400 pixels, and compresses supported images below the 4 MB application limit before upload. Gemini may retain uploaded files for up to 48 hours.

JPEG, PNG, WebP, HEIC, and HEIF sources up to 25 MB are accepted. When a browser cannot decode HEIC or HEIF, an original file already below 4 MB can still be sent directly to Gemini; larger files require conversion or a new capture.

## Verification

```sh
npm run check
npm test
npm run build
npm run preview
```

`POST /api/uploads`, `/api/ocr`, and `/api/tts` require the signed `__Host-bragi-session` cookie and an exact same-origin `Origin` header.

`/api/ocr` verifies the untrusted upload receipt against Gemini Files metadata before sending the file URI to the Interactions API. It uses structured output, high image resolution, and stateless processing. `/api/tts` remains a deterministic 300 ms WAV fixture until its live-model milestone.

JSON errors use `{ error: { code, message, requestId, retryable } }`; the same request ID is exposed through `X-Request-Id` on every API response.
