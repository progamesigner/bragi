import { Navigate } from "@solidjs/router";
import { Show } from "solid-js";
import Playback from "~/components/Playback";
import { useApp } from "~/lib/app-controller";
import { voice } from "~/lib/store/preferences";
import { workspace } from "~/lib/store/workspace";

/**
 * `/play`: read the draft aloud. Without a draft it goes to capture; with empty or overlong
 * segments it goes to review so they can be fixed. Leaving unmounts Playback, which stops audio,
 * cancels requests and releases the wake lock.
 */
export default function PlayScreen() {
  const app = useApp();
  return (
    <Show when={workspace.hasDraft()} fallback={<Navigate href="/" />}>
      <Show when={workspace.playable()} fallback={<Navigate href="/review" />}>
        <Show when={app.view()} keyed>
          <Playback
            requestRevision={app.requestRevision()}
            segments={workspace.segments}
            genreHint={workspace.genreHint().trim() || undefined}
            voice={voice()}
            onSettings={app.openSettings}
            onFinished={() => app.goTo("/finished")}
          />
        </Show>
      </Show>
    </Show>
  );
}
