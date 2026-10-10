# Changelog

## 1.1.0 — 2026-10-10

Interface rebuild, local drafts and a new reading flow. Verified on real iOS Safari and Android Chrome devices with the reading device checklist.

### Features

- Separate capture, review and reading screens inside a shared shell with a top bar, sign-in page and settings panel.
- Interface in Traditional Chinese, Simplified Chinese, English, Japanese, Korean, German and Spanish, following the browser's language preference, with terms aligned to a shared glossary.
- Text drafts are saved locally and offered for recovery after a reload once the session is confirmed. Exported drafts become undo checkpoints, and importing or replacing a draft offers to export first.
- Review cards edit progressively, with draft navigation and keyboard shortcuts.
- Searchable voice picker that filters by official trait and name and plays one preview at a time.
- Rebuilt narration controls on a single audio controller with recoverable playback and seeking, plus a reading completion screen that summarises what was played and prompts for an unexported draft.
- Recognition can be cancelled and shows its progress in a stage bar.
- Light and dark themes that follow the system, reduced motion support and short transitions between steps.
- New app icons and favicons from the wave card artwork, and a restyled offline page.

### Fixes

- Errors keep their code, request ID and retry hint and explain the failure. Error toasts announce themselves and can be closed, and reading messages float above the controls.
- Sign-out and session renewal keep workspace content safe.
- Failed image candidates stay available for another attempt, and a candidate image replaces the workspace only after recognition succeeds and is confirmed.
- Changing the voice or speed during reading keeps a single live preload.
- iPhone sheet spacing, reading controls and narrow-screen layouts no longer clip or overlap in any locale.

### Documentation

- README rewritten for first-time readers. API, architecture, operations, i18n glossary and the reading device checklist moved into `docs/`.

### Known issues

- `npm audit` still reports `braces` (GHSA-vfj7-8cjw-p6xm) through the `@solidjs/start` build tooling, unchanged from 1.0.0.

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
