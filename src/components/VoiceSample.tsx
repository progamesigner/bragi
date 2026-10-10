import { t } from "~/lib/i18n";
import { locale } from "~/lib/store/preferences";
import { VOICE_SAMPLE_TEXTS } from "~/lib/voice-samples";
import AudioPreview from "./AudioPreview";

type VoiceSampleProps = {
  requestRevision?: object;
  voice?: string;
  active: boolean;
  describedBy?: string;
};
export default function VoiceSample(props: VoiceSampleProps) {
  return (
    <AudioPreview
      owner="sample"
      input={{ text: VOICE_SAMPLE_TEXTS[locale()], voice: props.voice }}
      lang={locale()}
      requestRevision={props.requestRevision}
      active={props.active}
      valid={!!props.voice}
      describedBy={props.describedBy}
      label={t("voiceSample.audio")}
      playLabel={t("voiceSample.play")}
    />
  );
}
