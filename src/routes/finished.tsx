import { Navigate } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import Button from "~/components/ui/Button";
import { useApp } from "~/lib/app-controller";
import { audioTime } from "~/lib/audio/session";
import { t } from "~/lib/i18n";
import { playbackSegment } from "~/lib/playback";
import { workspace } from "~/lib/store/workspace";

/** A separate history entry. Back returns to /play, stopped at the remembered segment. */
export default function FinishedScreen() {
  const app = useApp();
  let heading: HTMLHeadingElement | undefined;
  const [leaving, setLeaving] = createSignal(false);
  const reachedEnd = () => {
    const last = workspace.segments.at(-1);
    if (!last) return false;
    const identity = playbackSegment(last, workspace.genreHint().trim() || undefined);
    return workspace
      .played()
      .some((entry) => entry.id === identity.id && entry.version === identity.version);
  };
  onMount(() => heading?.focus());
  return (
    <Show when={workspace.hasDraft()} fallback={<Navigate href="/" />}>
      <Show when={workspace.playable()} fallback={<Navigate href="/review" />}>
        <Show when={reachedEnd() || leaving()} fallback={<Navigate href="/play" />}>
          <section class="finished" aria-labelledby="finished-heading">
            <div class="finished-summary">
              <span class="finished-mark" aria-hidden="true">
                ✓
              </span>
              <h1 id="finished-heading" ref={heading} tabindex="-1">
                {t("finished.heading")}
              </h1>
              <p>
                {t(
                  workspace.played().length === workspace.segments.length
                    ? "finished.all"
                    : "finished.some",
                  { p: workspace.played().length, n: workspace.segments.length },
                )}
              </p>
              <p class="finished-duration">
                {t("finished.duration", {
                  time: audioTime(
                    workspace.played().reduce((sum, entry) => sum + entry.seconds, 0),
                  ),
                })}
              </p>
            </div>
            <Show when={workspace.dirty()}>
              <div class="finished-unexported">
                <div>
                  <h2>{t("finished.unexported")}</h2>
                  <p class="finished-export-note">{t("finished.exportNote")}</p>
                </div>
                <Button
                  variant="secondary"
                  class="finished-export"
                  size="compact"
                  onClick={app.exportForLoss}
                >
                  {t("review.export")}
                </Button>
              </div>
            </Show>
            <div class="finished-actions">
              <Button wide onClick={() => app.requestLoss("nextStory")}>
                {t("capture.heading")}
              </Button>
              <Button
                variant="secondary"
                wide
                onClick={() => {
                  // Keep the guard from replacing this history entry before goTo uses Back.
                  setLeaving(true);
                  workspace.resetPlayback();
                  app.goTo("/play");
                }}
              >
                {t("finished.again")}
              </Button>
              <Button variant="ghost" wide onClick={() => app.goTo("/review")}>
                {t("playback.back")}
              </Button>
            </div>
          </section>
        </Show>
      </Show>
    </Show>
  );
}
