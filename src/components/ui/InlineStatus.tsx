import { Show } from "solid-js";
import type { StatusMessage } from "~/lib/status";
import StatusDetails from "./StatusDetails";

type InlineStatusProps = {
  status?: StatusMessage;
  id?: string;
  class?: string;
};

/**
 * Progress and results shown next to the control that caused them. The polite region is always in
 * the page so screen readers notice each change; an error is inserted as an alert instead, so a
 * message is announced once, in one place.
 */
export default function InlineStatus(props: InlineStatusProps) {
  const error = () => (props.status?.tone === "error" ? props.status : undefined);
  return (
    <div class={`inline-status${props.class ? ` ${props.class}` : ""}`} id={props.id}>
      <p role="status" classList={{ "inline-status-success": props.status?.tone === "success" }}>
        {error() ? "" : props.status?.message}
      </p>
      <Show when={error()}>
        {(status) => (
          <div role="alert" class="inline-status-error">
            <p>{status().message}</p>
            <StatusDetails details={status().details} />
          </div>
        )}
      </Show>
    </div>
  );
}
