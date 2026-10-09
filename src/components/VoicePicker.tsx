import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { t } from "~/lib/i18n";
import {
  filterVoices,
  VOICE_SAMPLE_TEXT,
  type VoiceTrait,
  voiceLabel,
  voiceTrait,
  voiceTraits,
} from "~/lib/voices";
import AudioPreview from "./AudioPreview";
import Button from "./ui/Button";
import Select from "./ui/Select";
import Sheet from "./ui/Sheet";

type VoicePickerProps = {
  open: boolean;
  /** The server's voices; the first is its default. */
  voices: readonly string[];
  /** The voice the next playback will use. */
  current: string;
  onSelect: (voice: string) => void;
  onClose: () => void;
  requestRevision?: object;
};

/**
 * A second sheet on top of settings, so the 30 voices get the whole panel for searching, filtering
 * by their official trait and previewing, and Escape or Close returns to the settings that opened
 * it. Native radios give arrow-key selection; Enter on a voice confirms and closes.
 */
export default function VoicePicker(props: VoicePickerProps) {
  let list: HTMLFieldSetElement | undefined;
  let search: HTMLInputElement | undefined;
  return (
    <Sheet
      open={props.open}
      title={t("voicePicker.title")}
      closeLabel={t("voicePicker.close")}
      placement="side"
      class="voice-picker-sheet"
      onClose={props.onClose}
      initialFocus={() =>
        list?.querySelector<HTMLInputElement>("input:checked") ?? search ?? undefined
      }
    >
      <Show when={props.open}>
        <VoicePickerBody
          {...props}
          listRef={(element) => {
            list = element;
          }}
          searchRef={(element) => {
            search = element;
          }}
        />
      </Show>
    </Sheet>
  );
}

function VoicePickerBody(
  props: VoicePickerProps & {
    listRef: (element: HTMLFieldSetElement) => void;
    searchRef: (element: HTMLInputElement) => void;
  },
) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [trait, setTrait] = createSignal<VoiceTrait | undefined>();
  const traitLabel = (value: VoiceTrait) => t(`voiceTrait.${value}`);
  const shown = createMemo(() =>
    filterVoices(props.voices, { query: query(), trait: trait() }, traitLabel),
  );
  const traits = createMemo(() => voiceTraits(props.voices));

  return (
    <div class="voice-picker">
      <p class="voice-picker-current">
        {t("voicePicker.current", { voice: voiceLabel(props.current) })}
      </p>
      <p id={`${id}-applies`} class="settings-note">
        {t("settings.nextPlayback")}
      </p>
      <div class="voice-picker-filters">
        <div class="settings-field">
          <label for={`${id}-search`}>{t("voicePicker.search")}</label>
          <input
            ref={props.searchRef}
            id={`${id}-search`}
            type="search"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div class="settings-field">
          <label for={`${id}-trait`}>{t("voicePicker.trait")}</label>
          <Select
            id={`${id}-trait`}
            value={trait() ?? ""}
            onChange={(event) => setTrait((event.currentTarget.value || undefined) as VoiceTrait)}
          >
            <option value="">{t("voicePicker.allTraits", { n: props.voices.length })}</option>
            <For each={traits()}>
              {(entry) => (
                <option value={entry.trait}>
                  {t("voicePicker.traitOption", {
                    trait: traitLabel(entry.trait),
                    n: entry.count,
                  })}
                </option>
              )}
            </For>
          </Select>
        </div>
      </div>
      <p id={`${id}-sample`} class="settings-note voice-picker-sample">
        {t("voicePicker.sampleText")}
        <span lang="zh-Hant">{VOICE_SAMPLE_TEXT}</span>
      </p>
      <p class="voice-picker-count" role="status">
        {shown().length
          ? t("voicePicker.count", { n: shown().length, total: props.voices.length })
          : t("voicePicker.none")}
      </p>
      <Show when={!shown().length}>
        <Button
          variant="secondary"
          wide
          onClick={() => {
            setQuery("");
            setTrait(undefined);
          }}
        >
          {t("voicePicker.reset")}
        </Button>
      </Show>
      <fieldset ref={props.listRef} class="voice-list" aria-describedby={`${id}-applies`}>
        <legend class="visually-hidden">{t("prefs.voice")}</legend>
        <For each={shown()}>
          {(name) => {
            const selected = () => props.current === name;
            const trait = voiceTrait(name);
            return (
              <div class="voice-option" classList={{ "voice-option-current": selected() }}>
                <label class="voice-option-choice">
                  <input
                    type="radio"
                    name={`${id}-voice`}
                    value={name}
                    aria-label={
                      name === props.voices[0]
                        ? `${voiceLabel(name)} · ${t("voicePicker.default")}`
                        : voiceLabel(name)
                    }
                    checked={selected()}
                    onChange={() => props.onSelect(name)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.isComposing) return;
                      event.preventDefault();
                      props.onSelect(name);
                      props.onClose();
                    }}
                  />
                  <span class="voice-option-text">
                    <span class="voice-option-name">{name}</span>
                    <Show when={trait}>
                      {(value) => <span class="voice-option-trait">{traitLabel(value())}</span>}
                    </Show>
                    <span class="voice-option-badges">
                      <Show when={selected()}>
                        <span class="voice-badge voice-badge-current">
                          {t("voicePicker.inUse")}
                        </span>
                      </Show>
                      <Show when={name === props.voices[0]}>
                        <span class="voice-badge">{t("voicePicker.default")}</span>
                      </Show>
                    </span>
                  </span>
                </label>
                <AudioPreview
                  owner="sample"
                  input={{ text: VOICE_SAMPLE_TEXT, voice: name }}
                  requestRevision={props.requestRevision}
                  active={props.open}
                  valid
                  compact={{ subject: name }}
                  describedBy={`${id}-sample`}
                  label={t("voiceSample.audio")}
                  playLabel={t("voicePicker.preview")}
                />
              </div>
            );
          }}
        </For>
      </fieldset>
      <Button variant="primary" wide onClick={props.onClose}>
        {t("voicePicker.done")}
      </Button>
    </div>
  );
}
