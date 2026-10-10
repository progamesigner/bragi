import { type RouteSectionProps, useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createSignal, on, onMount, Show } from "solid-js";
import { AppContext, createAppController } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import { fontSize } from "~/lib/store/preferences";
import AppUpdate from "./AppUpdate";
import ConfirmLoss from "./ConfirmLoss";
import OtpForm from "./OtpForm";
import SettingsPanel from "./SettingsPanel";
import SignIn from "./SignIn";
import TopNav from "./TopNav";
import Banner from "./ui/Banner";
import Button from "./ui/Button";
import Sheet from "./ui/Sheet";
import StatusDetails from "./ui/StatusDetails";
import Toast from "./ui/Toast";

const SCREENS = ["/", "/review", "/play"];

/**
 * Fades the new screen in after moving between capture, review and playback. Only opacity changes,
 * so layout and focus are untouched, and nothing runs when the person asks for reduced motion.
 */
function fadeInScreen(main: HTMLElement | undefined) {
  if (!main || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
}

/**
 * The app layout around every route: top bar, notices, settings, confirmations and the toast.
 * Until a session exists it shows the sign-in page instead of any route.
 */
export default function Shell(props: RouteSectionProps) {
  const location = useLocation();
  const app = createAppController(useNavigate(), location);
  const [reauthOpen, setReauthOpen] = createSignal(false);
  const inApp = () => app.signedIn() && !app.welcome();
  let main: HTMLElement | undefined;

  onMount(() => {
    app.startOnline();
    void app.checkSession();
  });
  createEffect(
    on(app.auth, (auth) => {
      if (auth !== "expired") setReauthOpen(false);
    }),
  );
  createEffect(
    on(
      () => location.pathname,
      (path, previous) => {
        if (previous !== undefined && SCREENS.includes(path) && SCREENS.includes(previous))
          fadeInScreen(main);
      },
    ),
  );

  return (
    <AppContext.Provider value={app}>
      <div class="app" data-font-size={fontSize()}>
        <Show when={inApp()}>
          <TopNav onSettings={() => app.openSettings()} />
        </Show>
        <div class="app-notices">
          <Show when={!app.online()}>
            <Banner role="status" tone="warning">
              <p>{t("offline.notice")}</p>
            </Banner>
          </Show>
          <Show when={app.auth() === "expired"}>
            <Banner role="alert" tone="warning">
              <p>{t("reauth.notice")}</p>
              <Button size="compact" onClick={() => setReauthOpen(true)}>
                {t("reauth.action")}
              </Button>
            </Banner>
          </Show>
          <Show when={inApp() && app.error()}>
            {(error) => (
              <Banner role="alert" tone="error">
                <p>{error().message}</p>
                <StatusDetails details={error().details} />
                <Button variant="secondary" size="compact" onClick={app.dismissError}>
                  {t("notice.dismiss")}
                </Button>
              </Banner>
            )}
          </Show>
          <AppUpdate />
        </div>
        <Show when={inApp()} fallback={<SignIn />}>
          <main id="main" ref={main}>
            {props.children}
          </main>
          <SettingsPanel open={app.settingsOpen()} onClose={app.closeSettings} />
          <Sheet
            open={reauthOpen()}
            title={t("reauth.title")}
            closeLabel={t("reauth.close")}
            onClose={() => setReauthOpen(false)}
          >
            <p class="loss-body">{t("reauth.body")}</p>
            <OtpForm onSubmit={app.signIn} onSuccess={() => setReauthOpen(false)} />
          </Sheet>
        </Show>
        <ConfirmLoss />
        <Toast toast={app.toast()} onDismiss={app.dismissToast} />
      </div>
    </AppContext.Provider>
  );
}
