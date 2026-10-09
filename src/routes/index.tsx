import { onMount, Show } from "solid-js";
import Capture from "~/components/Capture";
import Button, { buttonClass } from "~/components/ui/Button";
import InlineStatus from "~/components/ui/InlineStatus";
import { useApp } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import { workspace } from "~/lib/store/workspace";

/** `/`: take or pick a picture, recognise it, or bring a draft back. */
export default function CaptureScreen() {
  const app = useApp();
  return (
    <Show when={app.view()} keyed>
      <CaptureContent />
    </Show>
  );
}

function CaptureContent() {
  const app = useApp();
  let heading!: HTMLHeadingElement;
  onMount(() => {
    if (app.navigated()) heading.focus();
  });

  return (
    <>
      <Show when={!app.authBusy() && app.savedDraft() && !workspace.hasDraft()}>
        <section class="card" aria-label={t("autosave.label")}>
          <p>{t("autosave.found")}</p>
          <Button size="compact" class="autosave-action" onClick={app.restoreAutosave}>
            {t("autosave.restore")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            class="autosave-action"
            onClick={app.discardAutosave}
          >
            {t("autosave.discard")}
          </Button>
        </section>
      </Show>
      <section class="card" aria-busy={app.recognitionBusy()} aria-labelledby="capture-heading">
        <h1 ref={heading} id="capture-heading" tabindex="-1">
          {t("capture.heading")}
        </h1>
        <p>{t("capture.intro")}</p>
        <Capture
          disabled={app.authBusy()}
          initial={app.candidate()}
          onSelect={app.selectCandidate}
          onCancel={app.cancelCandidate}
          onChange={app.setCandidate}
          onStatus={app.reportCapture}
        />
        <aside class="privacy-note" id="upload-privacy" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">{t("privacy.heading")}</h2>
          <ul>
            <li>{t("privacy.local")}</li>
            <li>{t("privacy.gemini")}</li>
            <li>{t("privacy.noHistory")}</li>
          </ul>
          <p>{t("privacy.avoid")}</p>
        </aside>
        <label for="genre">{t("genre.label")}</label>
        <input
          id="genre"
          type="text"
          placeholder={t("genre.placeholder")}
          disabled={app.recognitionBusy() || app.authBusy()}
          value={app.candidateActive() ? app.candidateGenre() : workspace.genreHint()}
          onInput={(event) => app.editGenre(event.currentTarget)}
        />
        <Button
          wide
          class="recognize"
          disabled={app.recognitionBusy() || !app.candidate() || app.authBusy()}
          onClick={() => void app.recognize()}
        >
          {app.recognitionBusy() ? t("recognize.busy") : t("recognize.start")}
        </Button>
        <InlineStatus status={app.captureStatus()} class="capture-status" />
        <div class="draft-import">
          <label
            class={`${buttonClass("secondary", "compact")} file-button`}
            for="draft-import"
            aria-disabled={app.authBusy()}
          >
            {t("draft.import")}
          </label>
          <input
            id="draft-import"
            class="visually-hidden"
            type="file"
            aria-describedby="draft-import-note"
            accept="application/json,.json"
            disabled={app.authBusy()}
            onChange={(event) => void app.importDraft(event.currentTarget)}
          />
          <p id="draft-import-note">{t("draft.importNote")}</p>
        </div>
      </section>
    </>
  );
}
