import { createSignal, onCleanup, onMount, Show } from "solid-js";

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
          if (!window.confirm("更新會重新載入，清除目前圖片、草稿與音訊。確定更新？")) return;
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
    <>
      <Show when={otherTabs()}>
        <p role="status">請先關閉其他 Bragi 分頁，再按更新。</p>
      </Show>
      <Show when={waiting()}>
        <p role="status">
          Bragi 有新版本。
          <button type="button" onClick={() => activate()()}>
            更新並重新載入
          </button>
        </p>
      </Show>
      <Show when={failed()}>
        <p>無法準備離線頁面；仍可正常使用線上功能。</p>
      </Show>
    </>
  );
}
