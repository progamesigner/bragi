import { createSignal, createUniqueId, onMount, Show } from "solid-js";
import type { SignInResult } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import { canSendOtp, editOtp, type OtpState } from "~/lib/otp";
import type { StatusMessage } from "~/lib/status";
import Button from "./ui/Button";
import StatusDetails from "./ui/StatusDetails";

type OtpFormProps = {
  onSubmit: (code: string) => Promise<SignInResult>;
  onSuccess?: () => void;
  /** Shown until the first attempt, e.g. when the session check itself failed. */
  initialError?: StatusMessage;
  autofocus?: boolean;
};

/**
 * The one-time code field used by the sign-in page and by signing in again after a session
 * expires. Six digits send automatically; the button stays for people who prefer it. A rejected
 * code cannot be sent again until it is changed.
 */
export default function OtpForm(props: OtpFormProps) {
  const id = createUniqueId();
  const [state, setState] = createSignal<OtpState>({ code: "" });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<StatusMessage | undefined>(props.initialError);
  let input!: HTMLInputElement;

  onMount(() => {
    if (props.autofocus) input.focus();
  });

  async function send() {
    const current = state();
    if (!canSendOtp(current, busy())) return;
    setBusy(true);
    setError(undefined);
    const result = await props.onSubmit(current.code);
    setBusy(false);
    if (result.ok) {
      setState({ code: "" });
      props.onSuccess?.();
      return;
    }
    // Block the code that was sent, even if the field changed while it was being checked.
    setState((latest) => ({ code: latest.code, rejected: current.code }));
    setError({ message: result.message, tone: "error", details: result.details });
    input.focus();
  }

  return (
    <form
      class="otp-form"
      noValidate
      aria-busy={busy()}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label for={`${id}-otp`}>{t("auth.otpLabel")}</label>
      <input
        ref={input}
        id={`${id}-otp`}
        class="otp-input"
        classList={{ invalid: !!error() }}
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        enterkeyhint="go"
        placeholder="••••••"
        aria-invalid={!!error()}
        aria-describedby={`${id}-help ${id}-message`}
        value={state().code}
        onInput={(event) => {
          const next = editOtp(state(), event.currentTarget.value);
          // Show the cleaned value (digits only) even when nothing else changed.
          event.currentTarget.value = next.code;
          if (next === state()) return;
          setState(next);
          setError(undefined);
          if (canSendOtp(next, busy())) void send();
        }}
      />
      <p id={`${id}-help`} class="otp-help">
        {t("auth.otpHelp")}
      </p>
      <div id={`${id}-message`} class="otp-message">
        <p role="status">{busy() ? t("auth.signingIn") : ""}</p>
        <Show when={!busy() && error()}>
          {(failure) => (
            <div role="alert" class="otp-error">
              <p>{failure().message}</p>
              <StatusDetails details={failure().details} />
            </div>
          )}
        </Show>
      </div>
      <Button type="submit" wide aria-disabled={!canSendOtp(state(), busy())} class="otp-submit">
        {t("auth.signIn")}
      </Button>
    </form>
  );
}
