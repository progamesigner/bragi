import { createEffect, createUniqueId, type JSX, on, onCleanup } from "solid-js";
import Button from "./Button";
import { CloseIcon } from "./icons";

type SheetProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Receives focus on open; defaults to the first focusable control in the body. */
  initialFocus?: () => HTMLElement | undefined;
  /** Where focus goes on close when the opener is gone or disabled. */
  fallbackFocus?: () => HTMLElement | undefined;
  /**
   * `bottom` (default) is a drawer on phones and a centred dialog on wider screens; `side` stays a
   * drawer on phones and becomes a panel along the right edge on landscape tablets.
   */
  placement?: "bottom" | "side";
  class?: string;
  children: JSX.Element;
};

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function canFocus(element: Element | null | undefined): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    !element.matches(":disabled") &&
    element.getClientRects().length > 0
  );
}

/** Focuses the page's main heading, making it programmatically focusable if needed. */
function focusPageHeading() {
  const heading = [...document.querySelectorAll<HTMLElement>("h1, h2")].find(
    (element) => !element.closest("dialog") && element.getClientRects().length > 0,
  );
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
}

/**
 * A modal sheet built on the native `<dialog>`: the browser keeps focus inside, makes the
 * page inert and closes it on Escape. Focus returns to whatever opened it.
 */
export default function Sheet(props: SheetProps) {
  const titleId = createUniqueId();
  let dialog!: HTMLDialogElement;
  let body!: HTMLDivElement;
  let closeButton!: HTMLButtonElement;
  let opener: Element | null = null;

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open && !dialog.open) {
          opener = document.activeElement;
          dialog.showModal();
          const target = props.initialFocus?.() ?? body.querySelector<HTMLElement>(FOCUSABLE);
          (target ?? closeButton).focus();
        } else if (!open && dialog.open) {
          dialog.close();
        }
      },
    ),
  );

  function closed() {
    // close events are queued: a newer question may already have reopened this same dialog.
    if (dialog.open) return;
    const target = canFocus(opener) ? opener : props.fallbackFocus?.();
    opener = null;
    if (canFocus(target)) target.focus();
    else focusPageHeading();
    if (props.open) props.onClose();
  }

  onCleanup(() => {
    if (dialog.open) dialog.close();
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent of a backdrop click is Escape, which the native dialog handles.
    <dialog
      ref={dialog}
      class={`sheet${props.placement === "side" ? " sheet-side" : ""}${props.class ? ` ${props.class}` : ""}`}
      aria-labelledby={titleId}
      onClose={closed}
      onClick={(event) => {
        // A click on the dialog box itself (not its content) is a click on the backdrop.
        if (event.target === dialog) dialog.close();
      }}
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <h2 id={titleId}>{props.title}</h2>
          <Button
            ref={closeButton}
            variant="ghost"
            class="button-icon"
            aria-label={props.closeLabel}
            title={props.closeLabel}
            onClick={() => dialog.close()}
          >
            <CloseIcon />
          </Button>
        </div>
        <div ref={body} class="sheet-body">
          {props.children}
        </div>
      </div>
    </dialog>
  );
}
