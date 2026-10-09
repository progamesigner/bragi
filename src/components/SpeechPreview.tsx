import { textBudget } from "~/lib/editing";
import { t } from "~/lib/i18n";
import AudioPreview from "./AudioPreview";

type SpeechPreviewProps = {
  requestRevision?: object;
  text: string;
  toneHint: string;
  genreHint?: string;
  voice?: string;
};
export default function SpeechPreview(props: SpeechPreviewProps) {
  return (
    <AudioPreview
      owner="review"
      input={{
        text: props.text,
        voice: props.voice,
        toneHint: props.toneHint || undefined,
        genreHint: props.genreHint || undefined,
      }}
      requestRevision={props.requestRevision}
      active
      valid={textBudget(props.text).valid}
      label={t("preview.audio")}
      playLabel={t("preview.generate")}
    />
  );
}
