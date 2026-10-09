import { Show } from "solid-js";
import type { ErrorDetails } from "~/lib/api";
import { t } from "~/lib/i18n";
import type { StatusTone } from "~/lib/status";

type ToastProps = {
  tone: StatusTone;
  message: string;
  details?: ErrorDetails;
};

/**
 * The single live region for progress and results. Errors use `alert` so they interrupt; everything
 * else is a polite `status`. Request IDs and codes sit behind a disclosure for support.
 */
export default function Toast(props: ToastProps) {
  return (
    <div
      class="toast"
      classList={{ success: props.tone === "success", error: props.tone === "error" }}
      role={props.tone === "error" ? "alert" : "status"}
    >
      <p>{props.message}</p>
      <Show when={props.details}>
        {(details) => (
          <details class="toast-details">
            <summary>{t("apiError.details")}</summary>
            <dl>
              <Show when={details().code}>
                <dt>{t("apiError.code")}</dt>
                <dd>{details().code}</dd>
              </Show>
              <Show when={details().status}>
                <dt>{t("apiError.status")}</dt>
                <dd>{details().status}</dd>
              </Show>
              <Show when={details().requestId}>
                <dt>{t("apiError.requestId")}</dt>
                <dd>
                  <code>{details().requestId}</code>
                </dd>
              </Show>
              <Show when={details().retryAfter !== undefined}>
                <dt>{t("apiError.retryAfterLabel")}</dt>
                <dd>{t("common.seconds", { s: details().retryAfter ?? 0 })}</dd>
              </Show>
            </dl>
          </details>
        )}
      </Show>
    </div>
  );
}
