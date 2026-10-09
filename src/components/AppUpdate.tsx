import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useApp } from "~/lib/app-controller";
import { t } from "~/lib/i18n";
import Banner from "./ui/Banner";
import Button from "./ui/Button";

/**
 * Registers the service worker and offers a waiting update as a banner. Applying it reloads the
 * page, so it goes through the same "export first" confirmation as clearing when unexported text
 * would be lost.
 */
export default function AppUpdate() {
  const app = useApp();
  const [waiting, setWaiting] = createSignal<ServiceWorker>();
  const [failed, setFailed] = createSignal(false);
  const [otherTabs, setOtherTabs] = createSignal(false);
  onMount(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let reload = false;
    const changed = () => {
      if (reload) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    const message = (event: MessageEvent) => {
      if (event.data === "CLOSE_OTHER_TABS") {
        reload = false;
        setOtherTabs(true);
      }
    };
    navigator.serviceWorker.addEventListener("message", message);
    app.setUpdateActivator(() => {
      reload = true;
      waiting()?.postMessage("ACTIVATE_UPDATE");
    });
    onCleanup(() => {
      disposed = true;
      app.setUpdateActivator(undefined);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      navigator.serviceWorker.removeEventListener("message", message);
    });
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        const check = () => {
          if (!disposed) setWaiting(registration.waiting ?? undefined);
        };
        check();
        registration.addEventListener("updatefound", () =>
          registration.installing?.addEventListener("statechange", check),
        );
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
  });
  return (
    <>
      <Show when={otherTabs()}>
        <Banner role="status" tone="warning">
          <p>{t("update.closeOtherTabs")}</p>
        </Banner>
      </Show>
      <Show when={waiting()}>
        <Banner role="status">
          <p>{t("update.available")}</p>
          <Button size="compact" onClick={() => app.requestLoss("update")}>
            {t("update.apply")}
          </Button>
        </Banner>
      </Show>
      <Show when={failed()}>
        <Banner>
          <p>{t("update.offlineUnavailable")}</p>
        </Banner>
      </Show>
    </>
  );
}
