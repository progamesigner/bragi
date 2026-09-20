const HEADER_BYTES = 44;

export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array<ArrayBuffer> {
  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0)
    throw new Error("Invalid PCM bit depth");
  if (pcm.byteLength % (channels * bytesPerSample) !== 0)
    throw new Error("PCM data does not contain complete samples");
  const buffer = new ArrayBuffer(HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, HEADER_BYTES).set(pcm);
  return new Uint8Array(buffer);
}

export function pcmDurationMs(
  byteLength: number,
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16,
): number {
  return Math.round((byteLength * 1000) / (sampleRate * channels * (bitsPerSample / 8)));
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
