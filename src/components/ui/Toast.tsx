import { createEffect, on, onCleanup, Show } from "solid-js";
import type { ErrorDetails } from "~/lib/api";
import type { ToastMessage } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import type { StatusTone } from "~/lib/status";
import Button, { IconButton } from "./Button";
import { CloseIcon } from "./icons";
import StatusDetails from "./StatusDetails";

/** A toast that may also carry a status tone; an error is announced as an alert and can be closed. */
export type ToastContent = ToastMessage & { tone?: StatusTone; details?: ErrorDetails };

type ToastProps = {
  toast?: ToastContent;
  onDismiss: () => void;
  /** How long a toast stays; the timer waits while focus or the pointer is inside it. */
  duration?: number;
  class?: string;
  /** Where focus goes when the control that held it leaves with the toast. */
  returnFocus?: () => HTMLElement | undefined;
};

/**
 * Short confirmations, optionally with one action such as undo. The polite live region stays in
 * the page and announces each message once; an error is inserted as an alert instead, with a
 * close button. A toast never takes focus.
 */
export default function Toast(props: ToastProps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let region!: HTMLDivElement;
  /** The element focus came from before it entered the toast. */
  let origin: HTMLElement | undefined;

  function stop() {
    clearTimeout(timer);
    timer = undefined;
  }
  function start() {
    stop();
    if (!props.toast || held) return;
    timer = setTimeout(dismiss, props.duration ?? 6000);
  }
  function hold(event?: FocusEvent) {
    const from = event?.relatedTarget;
    if (from instanceof HTMLElement && from !== document.body && !region.contains(from))
      origin = from;
    held = true;
    stop();
  }
  function release(event?: FocusEvent) {
    if (event && region.contains(event.relatedTarget as Node | null)) return;
    if (region.contains(document.activeElement) || region.matches(":hover")) return;
    held = false;
    start();
  }
  function dismiss() {
    const focused = region.contains(document.activeElement);
    held = false;
    props.onDismiss();
    // The focused button is about to disappear; leave focus where the person was, not on <body>.
    if (focused) {
      const target = origin?.isConnected ? origin : props.returnFocus?.();
      target?.focus({ preventScroll: true });
    }
    origin = undefined;
  }

  createEffect(on(() => props.toast?.id, start));
  onCleanup(stop);

  const error = () => (props.toast?.tone === "error" ? props.toast : undefined);
  return (
    <div
      ref={region}
      class={`toast${props.class ? ` ${props.class}` : ""}`}
      classList={{ "toast-empty": !props.toast, "toast-error": !!error() }}
      onFocusIn={hold}
      onFocusOut={release}
      onPointerEnter={() => hold()}
      onPointerLeave={() => release()}
    >
      <div role="status" class="toast-status">
        <Show when={props.toast && !error() ? props.toast : undefined}>
          {(toast) => (
            <>
              <p>{toast().message}</p>
              <Show
                when={
                  toast().action && (toast().action?.valid?.() ?? true) ? toast().action : undefined
                }
              >
                {(action) => (
                  <Button
                    variant="ghost"
                    size="compact"
                    class="toast-action"
                    onClick={() => {
                      action().run();
                      dismiss();
                    }}
                  >
                    {action().label}
                  </Button>
                )}
              </Show>
            </>
          )}
        </Show>
      </div>
      <Show when={error()}>
        {(toast) => (
          <>
            <div role="alert" class="toast-alert">
              <p>{toast().message}</p>
              <StatusDetails details={toast().details} />
            </div>
            <IconButton
              class="toast-close"
              size="compact"
              label={t("notice.dismiss")}
              onClick={dismiss}
            >
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Show>
    </div>
  );
}
