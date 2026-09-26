import { createInterface } from "node:readline";

const endpoints = new Map();
const times = [];
for await (const line of createInterface({ input: process.stdin })) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (
    row.event !== "bragi.request" ||
    !/^\/api\/(session|uploads|upload-content|ocr|tts|tts-stream)$/.test(row.endpoint)
  )
    continue;
  const key = `${row.method === "POST" ? "POST" : "other"} ${row.endpoint}`;
  const current = endpoints.get(key) ?? {
    requests: 0,
    errors: 0,
    rateLimited: 0,
    interrupted: 0,
    audioSeconds: 0,
    latencies: [],
  };
  current.requests++;
  if (row.status >= 400) current.errors++;
  if (row.status === 429) current.rateLimited++;
  if (row.outcome === "interrupted" || row.outcome === "cancelled") current.interrupted++;
  if (Number.isFinite(row.audioSeconds)) current.audioSeconds += row.audioSeconds;
  if (Number.isFinite(row.latencyMs)) current.latencies.push(row.latencyMs);
  endpoints.set(key, current);
  const time = Date.parse(row.time);
  if (row.method === "POST" && Number.isFinite(time)) times.push(time);
}
times.sort((a, b) => a - b);
let left = 0;
let peak = 0;
for (let right = 0; right < times.length; right++) {
  while (times[right] - times[left] >= 600_000) left++;
  peak = Math.max(peak, right - left + 1);
}
const report = [];
for (const [endpoint, { latencies, ...metrics }] of endpoints) {
  latencies.sort((a, b) => a - b);
  report.push({
    endpoint,
    ...metrics,
    p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
  });
}
console.log(
  JSON.stringify(
    {
      endpoints: report,
      observedGlobalPeakPostsPer10Minutes: peak,
      note: "Global request volume across the supplied logs; not per-IP traffic or billed cost.",
    },
    null,
    2,
  ),
);
