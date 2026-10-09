import { t } from "~/lib/i18n";
import { VOICE_SAMPLE_TEXT } from "~/lib/voices";
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
      input={{ text: VOICE_SAMPLE_TEXT, voice: props.voice }}
      requestRevision={props.requestRevision}
      active={props.active}
      valid={!!props.voice}
      describedBy={props.describedBy}
      label={t("voiceSample.audio")}
      playLabel={t("voiceSample.play")}
    />
  );
}
