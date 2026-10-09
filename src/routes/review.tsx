import { Navigate } from "@solidjs/router";
import { onCleanup, onMount, Show } from "solid-js";
import Review from "~/components/Review";
import { useApp } from "~/lib/app-controller";
import { voice } from "~/lib/store/preferences";
import { workspace } from "~/lib/store/workspace";

// Where review was scrolled to, for the draft it belonged to, so coming back keeps the place.
let saved: { view: object; scroll: number } | undefined;

/** `/review`: correct the draft. Without one there is nothing to review, so it goes to capture. */
export default function ReviewScreen() {
  const app = useApp();
  return (
    <Show when={workspace.detectedLanguage()} fallback={<Navigate href="/" />}>
      {(language) => (
        <Show when={app.view()} keyed>
          {(view) => {
            onMount(() => {
              const scroll = saved?.view === view ? saved.scroll : 0;
              requestAnimationFrame(() => window.scrollTo(0, scroll));
            });
            onCleanup(() => {
              saved = { view, scroll: window.scrollY };
            });
            return (
              <Review
                requestRevision={app.requestRevision()}
                detectedLanguage={language()}
                image={workspace.image()?.file}
                genreHint={workspace.genreHint().trim() || undefined}
                voice={voice()}
                onStartPlayback={() => app.goTo("/play")}
                onStatus={app.report}
                onToast={app.showToast}
              />
            );
          }}
        </Show>
      )}
    </Show>
  );
}
