const HEADER_BYTES = 44;

export function createTestWav(durationMs = 300): Uint8Array<ArrayBuffer> {
  const sampleRate = 24_000;
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const bytesPerSample = 2;
  const dataBytes = samples * bytesPerSample;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(index / 240, (samples - index) / 240, 1);
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.12 * fade;
    view.setInt16(HEADER_BYTES + index * bytesPerSample, Math.round(sample * 0x7fff), true);
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
