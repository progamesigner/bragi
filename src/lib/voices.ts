import { t } from "./i18n";
import { VOICE_CATALOG } from "./voice-catalog";

export { DEFAULT_VOICE, VOICE_CATALOG } from "./voice-catalog";

export type VoiceTrait = (typeof VOICE_CATALOG)[number][1];

const traits = new Map<string, VoiceTrait>(VOICE_CATALOG);

export function voiceLabel(voice: string): string {
  const trait = traits.get(voice);
  return trait ? `${voice} · ${t(`voiceTrait.${trait}`)}` : voice;
}

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
