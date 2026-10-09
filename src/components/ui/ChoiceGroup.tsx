import { createUniqueId, For, type JSX } from "solid-js";

export type Choice<T extends string> = { value: T; label: string; lang?: string };

type ChoiceGroupProps<T extends string> = {
  legend: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  describedBy?: string;
  children?: JSX.Element;
};

/**
 * A segmented control built from native radio buttons, so arrow keys, form semantics and screen
 * reader announcements come from the browser.
 */
export default function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>) {
  const name = createUniqueId();
  return (
    <fieldset class="choice-group" aria-describedby={props.describedBy}>
      <legend>{props.legend}</legend>
      <div class="choice-options" style={{ "--choices": props.options.length }}>
        <For each={props.options}>
          {(option) => (
            <label class="choice" lang={option.lang}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={props.value === option.value}
                onChange={() => props.onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          )}
        </For>
      </div>
      {props.children}
    </fieldset>
  );
}
