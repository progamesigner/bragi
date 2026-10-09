import { createSignal, For, onMount, Show } from "solid-js";
import Capture from "~/components/Capture";
import Button, { buttonClass } from "~/components/ui/Button";
import InlineStatus from "~/components/ui/InlineStatus";
import { useApp } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import { insertAfter } from "~/lib/state";
import { readString, writeString } from "~/lib/store/persist";
import { workspace } from "~/lib/store/workspace";

/** `/`: choose a candidate; the current script is untouched until its replacement is confirmed. */
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
  const [privacyOpen, setPrivacyOpen] = createSignal(true);
  let heading!: HTMLHeadingElement;
  const stages = ["prepare", "upload", "recognize"] as const;
  const stage = () => (app.preparing() ? "prepare" : app.recognitionStage());
  const hasCandidate = () => app.candidateActive();
  onMount(() => {
    setPrivacyOpen(readString("bragi-privacy-seen") !== "true");
    writeString("bragi-privacy-seen", "true");
    if (app.navigated()) heading.focus();
  });
  function addText() {
    workspace.edit(insertAfter(workspace.segments, -1));
    app.goTo("/review");
  }
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
      <section
        class="capture-screen"
        aria-busy={app.recognitionBusy() || app.preparing()}
        aria-labelledby="capture-heading"
        classList={{ "has-candidate": hasCandidate() }}
      >
        <h1 ref={heading} id="capture-heading" tabindex="-1">
          {t("capture.heading")}
        </h1>
        <p class="capture-intro">{t("capture.intro")}</p>
        <Show when={workspace.hasDraft()}>
          <div class="current-draft">
            <p>{t(workspace.segments.length ? "capture.preserveDraft" : "capture.emptyDraft")}</p>
            <Show
              when={workspace.segments.length > 0}
              fallback={
                <Button variant="secondary" onClick={addText}>
                  {t("capture.addText")}
                </Button>
              }
            >
              <Button variant="secondary" size="compact" onClick={() => app.goTo("/review")}>
                {t("capture.returnDraft")}
              </Button>
            </Show>
          </div>
        </Show>
        <div class="capture-layout">
          <Capture
            disabled={app.authBusy() || app.recognitionBusy()}
            initial={app.candidate()}
            onSelect={app.selectCandidate}
            onCancel={app.cancelCandidate}
            onChange={app.setCandidate}
            onStatus={app.reportCapture}
            onPreparing={app.setPreparing}
          >
            <label
              class={`${buttonClass("secondary")} file-button draft-import-button`}
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
          </Capture>
          <div class="capture-genre">
            <label for="genre">{t("genre.label")}</label>
            <input
              id="genre"
              type="text"
              placeholder={t("genre.placeholder")}
              disabled={app.recognitionBusy() || app.authBusy()}
              value={hasCandidate() ? app.candidateGenre() : workspace.genreHint()}
              onInput={(event) => app.editGenre(event.currentTarget)}
            />
          </div>
          <div class="recognition-controls">
            <Show when={stage()}>
              <ol class="recognition-stages" aria-label={t("recognize.stages")}>
                <For each={stages}>
                  {(value) => (
                    <li
                      aria-current={stage() === value ? "step" : undefined}
                      classList={{
                        done: stages.indexOf(value) < stages.indexOf(stage() ?? "prepare"),
                      }}
                    >
                      {t(`recognize.${value}Stage`)}
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <InlineStatus status={app.captureStatus()} class="capture-status" />
            <Show
              when={app.recognitionBusy()}
              fallback={
                <Show when={app.candidate()}>
                  <Button
                    wide
                    class="recognize"
                    disabled={app.authBusy()}
                    onClick={() => void app.recognize()}
                  >
                    {t(
                      app.captureStatus()?.tone === "error" ? "recognize.retry" : "recognize.start",
                    )}
                  </Button>
                </Show>
              }
            >
              <Button variant="secondary" wide onClick={app.cancelRecognition}>
                {t("recognize.cancel")}
              </Button>
              <p class="settings-note">{t("recognize.cancelNote")}</p>
            </Show>
          </div>
          <div class="capture-privacy" id="upload-privacy">
            <p class="privacy-summary">{t("privacy.summary")}</p>
            <details
              class="privacy-note"
              open={privacyOpen()}
              onToggle={(event) => setPrivacyOpen(event.currentTarget.open)}
            >
              <summary>{t("privacy.heading")}</summary>
              <ul>
                <li>{t("privacy.local")}</li>
                <li>{t("privacy.noHistory")}</li>
              </ul>
              <p>{t("privacy.avoid")}</p>
            </details>
            <p id="draft-import-note" class="settings-note">
              {t("draft.importNote")}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
