# Bragi

Mobile-first tabletop narration assistant. M0 establishes the SolidStart v2/Nitro foundation, TOTP authentication, protected API boundaries, and a browser-to-Gemini resumable upload spike.

## Local setup

1. Use Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and fill in secrets. Generate `BRAGI_SESSION_SECRET` with at least 32 random bytes.
3. Add the Base32 `BRAGI_TOTP_SECRET` to an authenticator app using an offline `otpauth://` QR-code workflow.
4. Run `npm run dev`.

The home page signs in with TOTP and performs the real browser CORS upload spike. Images are uploaded directly to Gemini Files and may be retained there for up to 48 hours.

## Verification

```sh
npm run check
npm test
npm run build
npm run preview
```

`POST /api/uploads`, `/api/ocr`, and `/api/tts` require the signed `__Host-bragi` cookie and an exact same-origin `Origin` header. OCR and TTS intentionally remain authenticated stubs for later milestones.
