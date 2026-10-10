// Pre-generates the voice picker samples in public/voice-samples/<locale>/<voice>.m4a, so
// previews play at once and never spend a Gemini call. Missing files fall back to live speech.
//
//   node --env-file=.env scripts/build-voice-samples.mjs [--force] [locale|voice ...]
//
// Existing files are kept unless --force is given; name locales or voices to limit the run, e.g.
// `--force ja Kore` regenerates Kore's Japanese take. Needs GEMINI_API_KEY and ffmpeg. Gemini
// takes vary, so listen to new files and regenerate any that misread or trail off.
import { execFile } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { VOICE_CATALOG } from "../src/lib/voice-catalog.ts";
import { VOICE_SAMPLE_TEXTS, voiceSamplePath } from "../src/lib/voice-samples.ts";

const SAMPLE_RATE = 24_000;
const CONCURRENCY = 4;
// Tier 1 allows 10 requests a minute for the TTS model; stay under it so retries are rare.
const REQUEST_INTERVAL_MS = 7_500;
const MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
const KEY = process.env.GEMINI_API_KEY?.trim();
if (!KEY) throw new Error("GEMINI_API_KEY is required");

const args = process.argv.slice(2);
const force = args.includes("--force");
const filters = args.filter((arg) => arg !== "--force");
const pick = (all) =>
  all.some((name) => filters.includes(name)) ? all.filter((name) => filters.includes(name)) : all;
const locales = pick(Object.keys(VOICE_SAMPLE_TEXTS));
const voices = pick(VOICE_CATALOG.map(([voice]) => voice));
const jobs = locales.flatMap((locale) =>
  voices.map((voice) => ({ locale, voice, text: VOICE_SAMPLE_TEXTS[locale] })),
);

const run = promisify(execFile);
const publicDir = new URL("../public", import.meta.url).pathname;
const scratch = new URL("../node_modules/.cache/voice-samples/", import.meta.url).pathname;
await mkdir(scratch, { recursive: true });

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

let quotaExhausted = false;
let nextSlot = 0;

/** Spaces request starts across all workers. */
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + REQUEST_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/** Same request and default style as src/lib/server/speech.ts, so samples match playback. */
async function synthesize(text, voice) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    let response;
    try {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        // A stalled connection otherwise holds its worker forever.
        signal: AbortSignal.timeout(60_000),
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          model: MODEL,
          store: false,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  annotations: [{ type: "speech_metadata", style: "Natural tabletop narration" }],
                },
              ],
            },
          ],
          response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
          generation_config: { speech_config: [{ voice }] },
        }),
      });
    } catch (error) {
      if (attempt >= 5) throw error;
      console.warn(`${voice}: ${error.name}, retrying`);
      continue;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    // A wait of hours is the daily quota; every remaining request would fail the same way.
    const body = response.status === 429 ? await response.text() : "";
    if (response.status === 429 && (retryAfter > 300 || /per day/i.test(body))) {
      quotaExhausted = true;
      throw new Error(`Gemini daily quota exhausted: ${body.slice(0, 200)}`);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const wait = Math.min(retryAfter || 2 ** attempt * 2, 60);
      console.warn(`${voice}: HTTP ${response.status}, retrying in ${wait} s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!response.ok)
      throw new Error(`Gemini ${response.status}: ${body || (await response.text())}`);
    const data = await response.json();
    const audio = data.steps
      .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
      .filter((content) => content.type === "audio")
      .at(-1);
    if (!audio?.data) throw new Error("Gemini returned no audio");
    return Buffer.from(audio.data, "base64");
  }
}

/** Takes far off the line's expected length usually misread, repeat or trail into noise. */
function plausible(seconds, text) {
  const units = /[\u3000-\u9fff\uac00-\ud7af]/.test(text) ? [...text].length : text.length / 2.5;
  return seconds >= units * 0.1 && seconds <= units * 0.45 + 1.5;
}

const failed = [];
async function build({ locale, voice, text }) {
  const target = `${publicDir}${voiceSamplePath(locale, voice)}`;
  if (!force && (await exists(target))) return;
  for (let take = 1; take <= 3; take++) {
    const pcm = await synthesize(text, voice);
    const seconds = pcm.byteLength / 2 / SAMPLE_RATE;
    if (!plausible(seconds, text)) {
      console.warn(`${locale}/${voice}: take ${take} is ${seconds.toFixed(1)} s, retrying`);
      continue;
    }
    const raw = `${scratch}${locale}-${voice}.pcm`;
    await writeFile(raw, pcm);
    await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    // AAC in MP4 plays everywhere including iOS Safari; 48 kbps mono is plenty for speech.
    await run("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", raw],
      ...["-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", "-map_metadata", "-1"],
      target,
    ]);
    await rm(raw);
    console.log(`${locale}/${voice}: ${seconds.toFixed(1)} s`);
    return;
  }
  failed.push(`${locale}/${voice}`);
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job && !quotaExhausted; job = queue.shift()) {
      try {
        await build(job);
      } catch (error) {
        console.error(`${job.locale}/${job.voice}: ${error.message}`);
        failed.push(`${job.locale}/${job.voice}`);
      }
    }
  }),
);
if (quotaExhausted) console.error(`Stopped with ${queue.length} samples left; rerun later.`);
if (failed.length) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}
