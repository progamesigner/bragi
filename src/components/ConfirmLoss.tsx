import { createEffect, createSignal, on, Show } from "solid-js";
import { type LossAction, useApp } from "~/lib/app-controller";
import { type MessageKey, t } from "~/lib/i18n";
import Button from "./ui/Button";
import Sheet from "./ui/Sheet";

const TEXT: Record<
  LossAction,
  { title: MessageKey; body: MessageKey; proceed: MessageKey; continue: MessageKey }
> = {
  clear: {
    title: "loss.clearTitle",
    body: "loss.clearBody",
    proceed: "loss.clearProceed",
    continue: "loss.clearContinue",
  },
  signOut: {
    title: "loss.signOutTitle",
    body: "loss.signOutBody",
    proceed: "loss.signOutProceed",
    continue: "loss.signOutContinue",
  },
  update: {
    title: "loss.updateTitle",
    body: "loss.updateBody",
    proceed: "loss.updateProceed",
    continue: "loss.updateContinue",
  },
};

/**
 * Asked when clearing, signing out or updating would discard workspace content. "Export first"
 * downloads the draft but never continues by itself: a download can fail silently, so the person
 * confirms they have the file and then continues with a separate button.
 */
export default function ConfirmLoss() {
  const app = useApp();
  const [exported, setExported] = createSignal(false);
  let continueButton: HTMLButtonElement | undefined;
  createEffect(on(app.pendingLoss, () => setExported(false)));
  const text = () => TEXT[app.pendingLoss() ?? "clear"];

  return (
    <Sheet
      open={!!app.pendingLoss()}
      title={t(text().title)}
      closeLabel={t("loss.cancel")}
      onClose={app.cancelLoss}
    >
      <p class="loss-body">{t(text().body)}</p>
      <Show
        when={exported()}
        fallback={
          <div class="loss-actions">
            <Show when={app.canExport()}>
              <Button
                wide
                onClick={() => {
                  if (!app.exportForLoss()) return;
                  setExported(true);
                  queueMicrotask(() => continueButton?.focus());
                }}
              >
                {t("loss.exportFirst")}
              </Button>
            </Show>
            <Button
              variant="danger"
              wide
              onClick={() => {
                const action = app.pendingLoss();
                if (action) app.perform(action);
              }}
            >
              {t(text().proceed)}
            </Button>
          </div>
        }
      >
        <p role="status" class="loss-exported">
          {t("loss.exported")}
        </p>
        <div class="loss-actions">
          <Button
            ref={continueButton}
            variant="danger"
            wide
            onClick={() => {
              const action = app.pendingLoss();
              if (action) app.perform(action);
            }}
          >
            {t(text().continue)}
          </Button>
          <Button variant="secondary" wide onClick={() => app.exportForLoss()}>
            {t("loss.exportAgain")}
          </Button>
        </div>
      </Show>
      <Button variant="ghost" wide onClick={app.cancelLoss}>
        {t("loss.cancel")}
      </Button>
    </Sheet>
  );
}
