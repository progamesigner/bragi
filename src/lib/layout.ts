import { createSignal, onCleanup, onMount } from "solid-js";

/** One breakpoint for the tablet layouts; server rendering starts with the phone layout. */
export function useWideLayout() {
  const [wide, setWide] = createSignal(false);
  onMount(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    onCleanup(() => media.removeEventListener("change", update));
  });
  return wide;
}
