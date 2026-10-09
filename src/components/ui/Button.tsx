import { type JSX, splitProps } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
/** `large` is for primary controls (at least 48px tall); `compact` still keeps a 44px target. */
export type ButtonSize = "large" | "compact";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  wide?: boolean;
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "large") {
  return `button button-${variant} button-${size}`;
}

export default function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "wide", "class", "type"]);
  return (
    <button
      type={local.type ?? "button"}
      class={`${buttonClass(local.variant, local.size)}${local.wide ? " button-wide" : ""}${local.class ? ` ${local.class}` : ""}`}
      {...rest}
    />
  );
}

export type IconButtonProps = Omit<ButtonProps, "aria-label" | "children" | "wide"> & {
  /** Icon-only buttons have no visible text, so the accessible name is required. */
  label: string;
  children: JSX.Element;
};

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["label", "class", "variant"]);
  return (
    <Button
      variant={local.variant ?? "ghost"}
      class={`button-icon${local.class ? ` ${local.class}` : ""}`}
      aria-label={local.label}
      title={local.label}
      {...rest}
    />
  );
}
