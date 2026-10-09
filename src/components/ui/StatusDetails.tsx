import { Show } from "solid-js";
import type { ErrorDetails } from "~/lib/api";
import { t } from "~/lib/i18n";

/** Error codes and request IDs for support, behind a disclosure so the message stays readable. */
export default function StatusDetails(props: { details?: ErrorDetails }) {
  return (
    <Show when={props.details}>
      {(details) => (
        <details class="status-details">
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
  );
}
