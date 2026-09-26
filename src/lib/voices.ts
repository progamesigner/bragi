/** Gemini TTS prebuilt voices and their official character, translated for the picker. */
export const VOICE_CATALOG = [
  ["Zephyr", "明亮"],
  ["Puck", "輕快"],
  ["Charon", "資訊感"],
  ["Kore", "堅定"],
  ["Fenrir", "興奮"],
  ["Leda", "年輕"],
  ["Orus", "堅定"],
  ["Aoede", "輕盈"],
  ["Callirrhoe", "隨和"],
  ["Autonoe", "明亮"],
  ["Enceladus", "氣音"],
  ["Iapetus", "清晰"],
  ["Umbriel", "隨和"],
  ["Algieba", "柔順"],
  ["Despina", "柔順"],
  ["Erinome", "清晰"],
  ["Algenib", "沙啞"],
  ["Rasalgethi", "資訊感"],
  ["Laomedeia", "輕快"],
  ["Achernar", "柔和"],
  ["Alnilam", "堅定"],
  ["Schedar", "平穩"],
  ["Gacrux", "成熟"],
  ["Pulcherrima", "直接"],
  ["Achird", "友善"],
  ["Zubenelgenubi", "隨興"],
  ["Vindemiatrix", "溫和"],
  ["Sadachbia", "活潑"],
  ["Sadaltager", "博學"],
  ["Sulafat", "溫暖"],
] as const;

export const DEFAULT_VOICE = "Kore";

const traits = new Map<string, string>(VOICE_CATALOG);

export function voiceLabel(voice: string): string {
  const trait = traits.get(voice);
  return trait ? `${voice} · ${trait}` : voice;
}

export const VOICE_SAMPLE_TEXT = "夜色降臨，古老的城門在眾人面前緩緩開啟。";
