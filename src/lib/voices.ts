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

export function voiceTrait(voice: string): VoiceTrait | undefined {
  return traits.get(voice);
}

export type VoiceFilter = { query: string; trait?: VoiceTrait };

/**
 * The voices a picker shows: those offered by the server that match the official trait and whose
 * name or translated trait contains the query, in alphabetical order so a name is easy to find.
 */
export function filterVoices(
  voices: readonly string[],
  filter: VoiceFilter,
  traitLabel: (trait: VoiceTrait) => string,
): string[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return voices
    .filter((voice) => {
      const trait = traits.get(voice);
      if (filter.trait && trait !== filter.trait) return false;
      if (!query) return true;
      return (
        voice.toLocaleLowerCase().includes(query) ||
        (trait !== undefined && traitLabel(trait).toLocaleLowerCase().includes(query))
      );
    })
    .sort((a, b) => a.localeCompare(b, "en"));
}

/** Each official trait among the offered voices, with how many voices have it, in catalog order. */
export function voiceTraits(voices: readonly string[]): { trait: VoiceTrait; count: number }[] {
  const counts = new Map<VoiceTrait, number>();
  for (const [name, trait] of VOICE_CATALOG)
    if (voices.includes(name)) counts.set(trait, (counts.get(trait) ?? 0) + 1);
  return [...counts].map(([trait, count]) => ({ trait, count }));
}
