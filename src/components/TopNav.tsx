import { useLocation } from "@solidjs/router";
import { For, Show } from "solid-js";
import { type AppPath, PARENT_PATH, useApp } from "~/lib/app-controller";
import { type MessageKey, t } from "~/lib/i18n";
import { workspace } from "~/lib/store/workspace";
import { IconButton } from "./ui/Button";
import { BackIcon, SettingsIcon, StepArrowIcon } from "./ui/icons";

type Step = { path: AppPath; label: MessageKey };

const STEPS: Step[] = [
  { path: "/", label: "nav.capture" },
  { path: "/review", label: "nav.review" },
  { path: "/play", label: "nav.play" },
];

/**
 * The bar on every signed-in screen: the wordmark on capture or "previous page" elsewhere, the three
 * steps (current one marked, unavailable ones explained and not clickable) and settings.
 */
export default function TopNav(props: { onSettings: () => void }) {
  const app = useApp();
  const location = useLocation();
  const current = () => location.pathname as AppPath;
  const activeStep = () => (current() === "/finished" ? "/play" : current());
  const parent = () => (current() === "/" && app.recognitionBusy() ? "/" : PARENT_PATH[current()]);

  /** Why a step cannot be opened yet, or nothing when it can. */
  function unavailable(path: AppPath): MessageKey | undefined {
    if (path === "/review" && (!workspace.hasDraft() || workspace.segments.length === 0))
      return "nav.reviewUnavailable";
    if (path === "/play" && (!workspace.hasDraft() || workspace.segments.length === 0))
      return "nav.playNeedsDraft";
    if (path === "/play" && !workspace.playable()) return "nav.playNeedsFixes";
    return undefined;
  }

  function follow(event: MouseEvent, path: AppPath) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (path === "/" && current() === "/" && app.recognitionBusy()) app.cancelRecognition();
    else app.goTo(path);
  }

  return (
    <header class="top-nav">
      <div class="top-nav-start">
        <Show when={parent()} fallback={<span class="wordmark">Bragi</span>}>
          {(target) => (
            <a class="top-nav-back" href={target()} onClick={(event) => follow(event, target())}>
              <BackIcon />
              {t("nav.previous")}
            </a>
          )}
        </Show>
      </div>
      <nav aria-label={t("nav.steps")} class="steps">
        <ol>
          <For each={STEPS}>
            {(step, index) => (
              <li>
                <Show when={index() > 0}>
                  <StepArrowIcon />
                </Show>
                <Show
                  when={!unavailable(step.path)}
                  fallback={
                    <span
                      class="step step-unavailable"
                      aria-disabled="true"
                      title={t(unavailable(step.path) ?? step.label)}
                    >
                      {t(step.label)}
                      <span class="visually-hidden">
                        {t("nav.unavailable", { reason: t(unavailable(step.path) ?? step.label) })}
                      </span>
                    </span>
                  }
                >
                  <a
                    class="step"
                    href={step.path}
                    aria-current={activeStep() === step.path ? "step" : undefined}
                    onClick={(event) => follow(event, step.path)}
                  >
                    {t(step.label)}
                  </a>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </nav>
      <div class="top-nav-end">
        <IconButton label={t("settings.open")} class="settings-button" onClick={props.onSettings}>
          <SettingsIcon />
        </IconButton>
      </div>
    </header>
  );
}
