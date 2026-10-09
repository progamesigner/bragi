import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "~/lib/i18n";
import Banner from "./ui/Banner";
import Button from "./ui/Button";

export default function AppUpdate() {
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
    onCleanup(() => {
      disposed = true;
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
        const activate = () => {
          if (!window.confirm(t("update.confirm"))) return;
          reload = true;
          waiting()?.postMessage("ACTIVATE_UPDATE");
        };
        setActivate(() => activate);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
  });
  const [activate, setActivate] = createSignal<() => void>(() => {});
  return (
    <div class="app-notices">
      <Show when={otherTabs()}>
        <Banner role="status" tone="warning">
          <p>{t("update.closeOtherTabs")}</p>
        </Banner>
      </Show>
      <Show when={waiting()}>
        <Banner role="status">
          <p>{t("update.available")}</p>
          <Button size="compact" onClick={() => activate()()}>
            {t("update.apply")}
          </Button>
        </Banner>
      </Show>
      <Show when={failed()}>
        <Banner>
          <p>{t("update.offlineUnavailable")}</p>
        </Banner>
      </Show>
    </div>
  );
}
