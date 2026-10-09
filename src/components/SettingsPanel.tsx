import { createUniqueId, For, Show } from "solid-js";
import { useApp } from "~/lib/app-controller";
import { LOCALE_NAMES, LOCALES, type Locale, t } from "~/lib/i18n";
import {
  type FontSize,
  fontSize,
  keepAwake,
  locale,
  PLAYBACK_RATES,
  type PlaybackRate,
  playbackRate,
  setFontSize,
  setKeepAwake,
  setLocale,
  setPlaybackRate,
  setThemePreference,
  setVoice,
  themePreference,
  voice,
  availableVoices as voices,
} from "~/lib/store/preferences";
import { THEME_PREFERENCES, type ThemePreference } from "~/lib/theme";
import { voiceLabel } from "~/lib/voices";
import Button from "./ui/Button";
import ChoiceGroup from "./ui/ChoiceGroup";
import Select from "./ui/Select";
import Sheet from "./ui/Sheet";
import Switch from "./ui/Switch";
import VoiceSample from "./VoiceSample";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

const FONT_SIZE_LABELS = {
  normal: "fontSize.normal",
  large: "fontSize.large",
  largest: "fontSize.largest",
} as const;

/**
 * Every device setting, reachable from any screen: a bottom drawer on phones and a side panel on
 * landscape tablets. Display and interface settings apply at once; voice and speed apply from the
 * next playback, as `PREFERENCE_APPLIES` documents.
 */
export default function SettingsPanel(props: SettingsPanelProps) {
  const app = useApp();
  const id = createUniqueId();
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  return (
    <Sheet
      open={props.open}
      title={t("settings.title")}
      closeLabel={t("settings.close")}
      placement="side"
      onClose={props.onClose}
    >
      <section class="settings-section" aria-labelledby={`${id}-display`}>
        <h3 id={`${id}-display`}>{t("settings.display")}</h3>
        <div class="settings-group">
          <ChoiceGroup<FontSize>
            legend={t("prefs.fontSize")}
            options={(["normal", "large", "largest"] as const).map((value) => ({
              value,
              label: t(FONT_SIZE_LABELS[value]),
            }))}
            value={fontSize()}
            onChange={setFontSize}
          >
            <p class="font-size-preview" aria-hidden="true">
              {t("settings.fontPreview")}
            </p>
          </ChoiceGroup>
          <Switch
            label={t("playback.keepAwake")}
            checked={keepAwake()}
            disabled={!wakeLockSupported}
            describedBy={`${id}-awake`}
            onChange={setKeepAwake}
          >
            <p id={`${id}-awake`} class="settings-note">
              {t(wakeLockSupported ? "settings.keepAwakeNote" : "settings.keepAwakeUnsupported")}
            </p>
          </Switch>
        </div>
      </section>

      <Show when={app.signedIn() && voices().length > 0}>
        <section class="settings-section" aria-labelledby={`${id}-voice`}>
          <h3 id={`${id}-voice`}>{t("settings.voiceSection")}</h3>
          <div class="settings-group">
            <div class="settings-field">
              <label for={`${id}-voice-select`}>{t("prefs.voice")}</label>
              <div class="voice-row">
                <Select
                  id={`${id}-voice-select`}
                  value={voice() ?? ""}
                  aria-describedby={`${id}-voice-note`}
                  onChange={(event) => setVoice(event.currentTarget.value || undefined)}
                >
                  <option value="">
                    {t("prefs.defaultVoice", { voice: voiceLabel(voices()[0] ?? "") })}
                  </option>
                  <For each={voices().slice(1)}>
                    {(value) => <option value={value}>{voiceLabel(value)}</option>}
                  </For>
                </Select>
                <Show when={app.view()} keyed>
                  <VoiceSample
                    voice={voice() ?? voices()[0]}
                    requestRevision={app.requestRevision()}
                    active={props.open}
                  />
                </Show>
              </div>
              <p id={`${id}-voice-note`} class="settings-note">
                {t("settings.nextPlayback")}
              </p>
            </div>
            <ChoiceGroup<`${PlaybackRate}`>
              legend={t("playback.rate")}
              options={PLAYBACK_RATES.map((value) => ({
                value: `${value}`,
                label: t("playback.rateOption", { n: value }),
              }))}
              value={`${playbackRate()}`}
              describedBy={`${id}-rate-note`}
              onChange={(value) => setPlaybackRate(Number(value) as PlaybackRate)}
            >
              <p id={`${id}-rate-note`} class="settings-note">
                {playbackRate() === 1 ? t("settings.nextPlayback") : t("playback.rateNote")}
              </p>
            </ChoiceGroup>
          </div>
        </section>
      </Show>

      <section class="settings-section" aria-labelledby={`${id}-interface`}>
        <h3 id={`${id}-interface`}>{t("settings.interface")}</h3>
        <div class="settings-group">
          <ChoiceGroup<ThemePreference>
            legend={t("settings.theme")}
            options={THEME_PREFERENCES.map((value) => ({ value, label: t(`theme.${value}`) }))}
            value={themePreference()}
            onChange={setThemePreference}
          />
          <div class="settings-field">
            <label for={`${id}-locale`}>{t("settings.language")}</label>
            <Select
              id={`${id}-locale`}
              value={locale()}
              onChange={(event) => setLocale(event.currentTarget.value as Locale)}
            >
              <For each={LOCALES}>
                {(value) => (
                  <option value={value} lang={value}>
                    {LOCALE_NAMES[value]}
                  </option>
                )}
              </For>
            </Select>
          </div>
        </div>
      </section>

      <Show when={app.signedIn()}>
        <section class="settings-section" aria-labelledby={`${id}-data`}>
          <h3 id={`${id}-data`}>{t("settings.data")}</h3>
          <div class="settings-group">
            <p class="settings-note">{t("auth.signedIn")}</p>
            <Button variant="secondary" wide onClick={() => app.requestLoss("clear")}>
              {t("workspace.clear")}
            </Button>
            <Button
              variant="danger"
              wide
              disabled={app.authBusy()}
              onClick={() => app.requestLoss("signOut")}
            >
              {app.authBusy() ? t("auth.signingOut") : t("auth.signOut")}
            </Button>
          </div>
        </section>
      </Show>
    </Sheet>
  );
}
