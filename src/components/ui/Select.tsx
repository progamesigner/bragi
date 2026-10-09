import { type JSX, splitProps } from "solid-js";

export type SelectProps = JSX.SelectHTMLAttributes<HTMLSelectElement>;

/** A native select (keeps platform pickers and semantics) with the app's field styling. */
export default function Select(props: SelectProps) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <span class="select">
      <select class={`select-control${local.class ? ` ${local.class}` : ""}`} {...rest} />
    </span>
  );
}
