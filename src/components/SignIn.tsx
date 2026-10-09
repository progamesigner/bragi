import { For, Match, onMount, Show, Switch } from "solid-js";
import { useApp } from "~/lib/app-controller";
import { LOCALE_NAMES, LOCALES, type Locale, t } from "~/lib/i18n";
import { locale, setLocale } from "~/lib/store/preferences";
import OtpForm from "./OtpForm";
import Button from "./ui/Button";
import { GlobeIcon } from "./ui/icons";
import Select from "./ui/Select";

/**
 * The sign-in page. The state area has a fixed height, so checking, signing in, an error and
 * success never move the introduction above it or the language menu below it.
 */
export default function SignIn() {
  const app = useApp();
  return (
    <main class="sign-in">
      <div class="sign-in-intro">
        <p class="wordmark wordmark-large">Bragi</p>
        <h1 class="sign-in-title">
          {t("header.titleLine1")}
          <br />
          {t("header.titleLine2")}
        </h1>
        <p class="lede">{t("header.lede")}</p>
      </div>

      <div class="sign-in-state">
        {/* One persistent region announces checking and success; the form owns its own messages. */}
        <p role="status" class="sign-in-status" classList={{ "sign-in-success": app.welcome() }}>
          <Show when={app.auth() === "checking"}>
            <span class="spinner" aria-hidden="true" />
          </Show>
          {app.auth() === "checking" ? t("auth.checking") : app.welcome() ? t("auth.success") : ""}
        </p>
        <Switch>
          <Match when={app.welcome()}>
            <Welcome onContinue={app.enter} />
          </Match>
          <Match when={app.auth() !== "checking"}>
            <OtpForm
              onSubmit={app.signIn}
              initialError={app.sessionError()}
              autofocus={!!app.sessionError()}
            />
          </Match>
        </Switch>
      </div>

      <div class="sign-in-language">
        <GlobeIcon />
        <label for="sign-in-locale" class="visually-hidden">
          {t("settings.language")}
        </label>
        <Select
          id="sign-in-locale"
          class="select-quiet"
          value={locale()}
          onChange={(event) => setLocale(event.currentTarget.value as Locale)}
        >
          <For each={LOCALES}>
            {(value) => (
              <option value={value} lang={value}>
                {LOCALE_NAMES[value]}
              </option>
            )}
          </For>
        </Select>
      </div>
    </main>
  );
}

function Welcome(props: { onContinue: () => void }) {
  let button!: HTMLButtonElement;
  onMount(() => button.focus());
  return (
    <Button ref={button} wide onClick={props.onContinue}>
      {t("auth.continue")}
    </Button>
  );
}
