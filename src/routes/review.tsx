import { Navigate } from "@solidjs/router";
import { onMount, Show } from "solid-js";
import Review, { type ReviewPosition } from "~/components/Review";
import { useApp } from "~/lib/app-controller";
import { voice } from "~/lib/store/preferences";
import { workspace } from "~/lib/store/workspace";

// Where review was scrolled to, for the draft it belonged to, so coming back keeps the place.
let saved: ({ view: object } & ReviewPosition) | undefined;

/** `/review`: correct the draft. Without one there is nothing to review, so it goes to capture. */
export default function ReviewScreen() {
  const app = useApp();
  return (
    <Show
      when={
        workspace.hasDraft() && workspace.segments.length > 0
          ? workspace.detectedLanguage()
          : undefined
      }
      fallback={<Navigate href="/" />}
    >
      {(language) => (
        <Show when={app.view()} keyed>
          {(view) => {
            onMount(() => {
              const scroll = saved?.view === view ? saved.scroll : 0;
              requestAnimationFrame(() => window.scrollTo(0, scroll));
            });
            return (
              <Review
                position={saved?.view === view ? saved : undefined}
                onRememberPosition={(position) => {
                  saved = { view, ...position };
                }}
                requestRevision={app.requestRevision()}
                detectedLanguage={language()}
                image={workspace.image()?.file}
                genreHint={workspace.genreHint().trim() || undefined}
                voice={voice()}
                onStartPlayback={() => app.goTo("/play")}
                onReturnReview={() => app.goTo("/review")}
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
