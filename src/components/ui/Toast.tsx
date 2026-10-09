import { createEffect, on, onCleanup, Show } from "solid-js";
import type { ToastMessage } from "~/lib/app-controller";
import Button from "./Button";

type ToastProps = {
  toast?: ToastMessage;
  onDismiss: () => void;
  /** How long a toast stays; the timer waits while focus or the pointer is inside it. */
  duration?: number;
};

/**
 * Short confirmations, optionally with one action such as undo. The polite live region stays in
 * the page; errors never come here (they are banners or sit next to their control).
 */
export default function Toast(props: ToastProps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let region!: HTMLDivElement;

  function stop() {
    clearTimeout(timer);
    timer = undefined;
  }
  function start() {
    stop();
    if (!props.toast || held) return;
    timer = setTimeout(() => props.onDismiss(), props.duration ?? 6000);
  }
  function hold() {
    held = true;
    stop();
  }
  function release(event?: FocusEvent) {
    if (event && region.contains(event.relatedTarget as Node | null)) return;
    if (region.contains(document.activeElement) || region.matches(":hover")) return;
    held = false;
    start();
  }

  createEffect(on(() => props.toast?.id, start));
  onCleanup(stop);

  return (
    <div
      ref={region}
      class="toast"
      classList={{ "toast-empty": !props.toast }}
      role="status"
      onFocusIn={hold}
      onFocusOut={release}
      onPointerEnter={hold}
      onPointerLeave={() => release()}
    >
      <Show when={props.toast}>
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
                    props.onDismiss();
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
  );
}
