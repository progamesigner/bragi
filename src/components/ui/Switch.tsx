import { createUniqueId, type JSX } from "solid-js";

type SwitchProps = {
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
  children?: JSX.Element;
};

/** An on/off setting: a native checkbox exposed as a switch, with the whole row as its label. */
export default function Switch(props: SwitchProps) {
  const id = createUniqueId();
  return (
    <div class="switch-row">
      <label for={id}>{props.label}</label>
      <input
        id={id}
        class="switch"
        type="checkbox"
        role="switch"
        checked={props.checked}
        aria-checked={props.checked}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.children}
    </div>
  );
}
