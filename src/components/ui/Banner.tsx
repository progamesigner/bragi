import type { JSX } from "solid-js";

export type BannerTone = "info" | "warning" | "error" | "success";

type BannerProps = {
  tone?: BannerTone;
  /** `status` for polite announcements, `alert` for errors that need attention now. */
  role?: "status" | "alert";
  children: JSX.Element;
};

/** An inline, full-width notice about the app's state (offline, updates). */
export default function Banner(props: BannerProps) {
  return (
    <div class={`banner banner-${props.tone ?? "info"}`} role={props.role}>
      {props.children}
    </div>
  );
}
