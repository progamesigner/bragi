# Changelog

## 1.0.0 — 2026-10-08

First stable release.

### Features

- TOTP sign-in with a signed, 90-day persistent session that can be restored and revoked.
- Image capture or selection with on-device EXIF orientation, resizing and compression, uploaded through Bragi to Gemini Files.
- Structured OCR with `gemini-3.8-flash` into editable narration segments.
- Review editor with text and tone edits, splitting, merging, insertion, deletion, editing history, spoken-text corrections and image comparison.
- Text-only draft export and import (`bragi-draft`, version 1).
- Step-by-step narration with `gemini-3.8-flash-tts`: progressive PCM streaming, one-segment prefetch, a bounded in-memory audio cache and per-caller cancellation.
- Playback controls for all 30 prebuilt voices with samples, 0.75×–1.5× speed with preserved pitch, opt-in screen wake lock and recovery after system audio interruptions.
- Installable app with a versioned service worker, offline page, confirmed updates and reading font presets.
- Structured operational logs, request IDs on every API response and a log metrics script.

### Security

- Upgrade `solid-js` to 1.9.17 to pull in a patched `seroval` (GHSA-p6vx-979v-rg4c, GHSA-jp82-f5mq-hwhp).
- Upgrade `@solidjs/start` to 2.0.6 and `vite` to 8.3.4, and refresh transitive dependencies including `source-map-js`.

### Known issues

- `npm audit` still reports `braces` (GHSA-vfj7-8cjw-p6xm) through the `@solidjs/start` build tooling. No patched version exists yet; it is used at build time, not when serving requests.
