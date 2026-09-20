# Bragi

Mobile-first tabletop narration assistant. M0 establishes the SolidStart v2/Nitro foundation, TOTP authentication, protected API boundaries, and a same-origin proxy for Gemini resumable uploads.

## Local setup

1. Use Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and fill in secrets. Generate `BRAGI_SESSION_SECRET` with at least 32 random bytes.
3. Add the Base32 `BRAGI_TOTP_SECRET` to an authenticator app using an offline `otpauth://` QR-code workflow.
4. Run `npm run dev`.

The home page signs in with TOTP and uploads images through Bragi to Gemini Files. The 4 MB application limit stays below Vercel Functions' 4.5 MB request limit. Gemini may retain uploaded files for up to 48 hours.

## Verification

```sh
npm run check
npm test
npm run build
npm run preview
```

`POST /api/uploads`, `/api/ocr`, and `/api/tts` require the signed `__Host-bragi-session` cookie and an exact same-origin `Origin` header. OCR and TTS intentionally use authenticated fixtures until their live-model milestones.

M1 fixes the processing contracts before live model integration. `/api/ocr` returns deterministic segments, while `/api/tts` returns a deterministic 300 ms WAV fixture. JSON errors use `{ error: { code, message, requestId, retryable } }`; the same request ID is exposed through `X-Request-Id` on every API response.
