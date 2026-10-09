# Bragi

Mobile-first tabletop narration assistant. Bragi uploads a tabletop script or card image to Gemini, extracts structured narration segments, and prepares them for reviewed, step-by-step playback.

## Local setup

1. Use Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and fill in secrets. Generate `BRAGI_SESSION_SECRET` with at least 32 random bytes.
3. Add the Base32 `BRAGI_TOTP_SECRET` to an authenticator app using an offline `otpauth://` QR-code workflow.
4. Run `npm run dev`.

The home page signs in with TOTP, captures or selects an image, uploads it through Bragi to Gemini Files, and runs live OCR with `gemini-3.8-flash`. The browser normalizes EXIF orientation, limits the longest edge to 2,400 pixels, and compresses supported images below the 4 MB application limit before upload. Gemini may retain uploaded files for up to 48 hours.

OCR output opens as an editable review draft. Every segment supports text and tone edits, cursor-position splitting, merging with the next segment, insertion, and deletion. A segment can also carry separate spoken text for pronunciation fixes: the transcript stays unchanged on screen, while previews, prefetching, streaming, WAV replay and the audio cache all use the spoken text. Both must pass the speech length limits before playback. Splitting a corrected segment drops the correction, and merging combines the effective spoken text of both segments. Text drafts are saved after about one second of inactivity in localStorage on this device and browser only. After a reload, choose “恢復上次的草稿” or “捨棄”; restoration makes no Gemini request and never overwrites an active workspace. Clearing the workspace, signing out, or discarding the saved draft deletes this local copy. Storage failures silently leave editing available. Images, audio, voice selection and session data are never part of the autosaved draft. For a portable backup, use “匯出草稿” to download a versioned JSON file (`bragi-draft`, version 1) containing only the detected language, genre hint and segment text, tone and spoken text. It never includes images, audio, voice selection or session data. Importing a draft replaces the current workspace after confirmation when an existing draft would be lost and makes no Gemini request. Editing, export and import share a 200,000-byte UTF-8 file budget and a 50-segment limit. Text and spoken text allow 10,000 graphemes each, tone 120, genre 80 and language 35; IDs allow 64 graphemes. Changes that exceed these limits are rejected before changing the draft. Imports validate the complete payload and its canonical export size before replacement, reject unknown versions, duplicate IDs and extra fields, and may contain text that still needs splitting before playback.

After review, the first uncached segment starts through progressive PCM streaming, so playback can begin before Gemini finishes the entire response. Completed streams are wrapped as WAV and enter the same bounded in-memory cache used by speech previews and later playback. Identical concurrent requests share one synthesis call; each preview, prefetch or playback caller can cancel independently, and the upstream request is aborted only after every caller has left. A cancelled request never writes into the cache, and a fresh request after full cancellation starts a new call. Bragi prepares at most one following segment in the background, retains no more than three entries or 9 MB, and clears them when the image changes or the user signs out. Playback still stops after every segment until the user explicitly replays it or continues. If the phone suspends Web Audio during streamed playback (a call, the lock screen or another app), Bragi marks the segment as paused and asks for a tap on “繼續播放” to resume from the interruption point; it does not promise background playback. Returning to review preserves the current draft, while leaving playback cancels active speech requests, stops Web Audio sources, and releases generated audio URLs.

Progress, success, and error notices use distinct accessible live-region semantics, and API failures retain their request ID for troubleshooting. Keyboard focus follows the review and playback views, invalid empty segments include field guidance, and all controls expose a visible focus indicator. The upload screen explains which processing stays on-device, which data is sent to Gemini, and what Bragi does not persist.

JPEG, PNG, WebP, HEIC, and HEIF sources up to 25 MB are accepted. When a browser cannot decode HEIC or HEIF, an original file already below 4 MB can still be sent directly to Gemini; larger files require conversion or a new capture.

## Verification

```sh
npm run check
npm run typecheck
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run preview
```

`test:e2e` builds and runs the production server, then checks the mobile flow with synthetic API responses and a separate real-service-worker test. It requires no Gemini credentials or quota. GitHub Actions runs the same checks. For a deployment check without generating content, run `BRAGI_SMOKE_URL=https://your-deployment npm run test:smoke`.

## App settings and installation

Bragi can be installed using the browser's app installation controls. Its versioned service worker caches only public static assets, with a separate offline landing page. API responses, images, drafts and generated audio are never stored in Cache Storage. A waiting update requires confirmation before reloading and clearing the workspace; close other Bragi tabs before applying it.

The app icons, Apple touch icon and favicons in `public/` are generated from `assets/icon/icon.svg` and `assets/icon/icon-maskable.svg` (keep the maskable artwork inside the central 80% circle). After replacing either SVG, run `node scripts/build-icons.mjs`; it renders the PNGs with the Chromium that Playwright installs, and `scripts/pwa-assets.mjs` lists the files the service worker precaches.

The app reports offline status and requires manual retry after reconnecting. “Clear current content” confirms before cancelling work and removing the image, draft and audio, while preserving login.

Reading font presets are saved locally. When the browser supports the Screen Wake Lock API, the playback screen offers an opt-in “朗讀時保持螢幕常亮” setting. The choice is saved locally, the lock is reacquired when the page becomes visible again, and it is released when leaving playback. All 30 Gemini prebuilt voices are available in the voice picker, labelled with their official character (default Kore). The choice applies to the whole story, is remembered on this device, and can be auditioned with a fixed sample sentence that stays out of the narration audio cache. The server rejects voices outside the catalog. Previous/next controls select a segment without starting generation. Playback supports 0.75×, 1×, 1.25× and 1.5× speed; choose the speed before playing. At 1× the first uncached segment streams progressively. Other speeds skip streaming and play complete WAV audio with the browser's native `preservesPitch`, so the original pitch is kept at the cost of waiting for the whole segment before playback starts.

## Operational logs

Server JSON logs record endpoint, request ID, model, status, latency, input size bucket and speech duration, with completion, cancellation and interruption outcomes. Browser cache logs record only hit/miss/pending and request purpose. Logs exclude images, transcripts, credentials, upload capabilities and provider error details.

Pipe exported JSON log lines to `npm run metrics` for request counts, errors, 429s, p95 latency, audio duration and peak global request volume. These are operational measurements, not a billing estimate. WAF recalibration and external billing/quota alert setup are cancelled; existing protection remains unchanged.

`POST /api/uploads`, `/api/ocr`, `/api/tts`, and `/api/tts-stream` require the signed `__Host-bragi-session` cookie and an exact same-origin `Origin` header. The JWT and persistent cookie expire together after 90 days. `GET /api/session` restores the signed-in interface without exposing the token, while `DELETE /api/session` expires it and clears the active browser workspace.

Upload session creation, the upload proxy, OCR and both speech routes pass the client's disconnect signal to Gemini alongside their provider timeouts. A request cancelled by the client ends with `499 REQUEST_CANCELLED` and is logged with the `cancelled` outcome. Cancelling stops Bragi from waiting, but cannot undo work Gemini has already started or billed.

`/api/ocr` verifies the untrusted upload receipt against Gemini Files metadata before sending the file URI to the Interactions API. It uses structured output, high image resolution, and stateless processing.

`/api/tts` uses `gemini-3.8-flash-tts` (override with `GEMINI_TTS_MODEL`) with the selected voice. The segment text is sent strictly as a verbatim transcript, while tone and genre hints travel separately as `speech_metadata` style, so directions are never read aloud. Both speech routes explicitly request raw 24 kHz `audio/l16`. It validates the returned 24 kHz mono PCM and limits it to 60 seconds, wraps it in WAV, and retries one transient or missing-audio response. Review segments expose manual previews through native audio controls; generated object URLs are revoked when the text changes or the component is removed.

`/api/tts-stream` uses Gemini Interactions SSE and forwards only validated audio deltas as bounded 24 kHz, 16-bit mono PCM. The browser schedules these chunks through Web Audio, preserves split samples across transport boundaries, and reconstructs a complete WAV for replay and in-memory reuse. The non-streaming `/api/tts` path remains available for previews, prefetching, cache misses on browsers without Web Audio, and explicit fallback.

JSON errors use `{ error: { code, message, requestId, retryable } }`; the same request ID is exposed through `X-Request-Id` on every API response.
