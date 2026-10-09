import type { JSX } from "solid-js";
import type { StatusTone } from "~/lib/status";

type ToastProps = {
  tone: StatusTone;
  children: JSX.Element;
};

/**
 * The single live region for progress and results. Errors use `alert` so they interrupt; everything
 * else is a polite `status`.
 */
export default function Toast(props: ToastProps) {
  return (
    <div
      class="toast"
      classList={{ success: props.tone === "success", error: props.tone === "error" }}
      role={props.tone === "error" ? "alert" : "status"}
    >
      {props.children}
    </div>
  );
}
