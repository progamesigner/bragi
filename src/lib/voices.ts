import { t } from "./i18n";

/** Gemini TTS prebuilt voices and their official character; the picker shows it translated. */
export const VOICE_CATALOG = [
  ["Zephyr", "bright"],
  ["Puck", "upbeat"],
  ["Charon", "informative"],
  ["Kore", "firm"],
  ["Fenrir", "excitable"],
  ["Leda", "youthful"],
  ["Orus", "firm"],
  ["Aoede", "breezy"],
  ["Callirrhoe", "easyGoing"],
  ["Autonoe", "bright"],
  ["Enceladus", "breathy"],
  ["Iapetus", "clear"],
  ["Umbriel", "easyGoing"],
  ["Algieba", "smooth"],
  ["Despina", "smooth"],
  ["Erinome", "clear"],
  ["Algenib", "gravelly"],
  ["Rasalgethi", "informative"],
  ["Laomedeia", "upbeat"],
  ["Achernar", "soft"],
  ["Alnilam", "firm"],
  ["Schedar", "even"],
  ["Gacrux", "mature"],
  ["Pulcherrima", "forward"],
  ["Achird", "friendly"],
  ["Zubenelgenubi", "casual"],
  ["Vindemiatrix", "gentle"],
  ["Sadachbia", "lively"],
  ["Sadaltager", "knowledgeable"],
  ["Sulafat", "warm"],
] as const;

export const DEFAULT_VOICE = "Kore";

export type VoiceTrait = (typeof VOICE_CATALOG)[number][1];

const traits = new Map<string, VoiceTrait>(VOICE_CATALOG);

export function voiceLabel(voice: string): string {
  const trait = traits.get(voice);
  return trait ? `${voice} · ${t(`voiceTrait.${trait}`)}` : voice;
}

/** Spoken content, so it stays in Chinese whatever the interface language. */
export const VOICE_SAMPLE_TEXT = "夜色降臨，古老的城門在眾人面前緩緩開啟。";
