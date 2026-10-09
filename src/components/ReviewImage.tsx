import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "~/lib/i18n";
import Button from "./ui/Button";
import Select from "./ui/Select";

/** Only the prepared image: zoom changes its display size, never its detail. */
export default function ReviewImage(props: { url: string }) {
  const [zoom, setZoom] = createSignal(1);
  const [failed, setFailed] = createSignal(false);
  let scroller!: HTMLElement;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { distance: number; zoom: number } | undefined;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  function scale(value: number, x?: number, y?: number) {
    const next = Number(Math.min(4, Math.max(1, value)).toFixed(2));
    const bounds = scroller?.getBoundingClientRect();
    const anchorX = x === undefined ? (bounds?.width ?? 0) / 2 : x - (bounds?.left ?? 0);
    const anchorY = y === undefined ? (bounds?.height ?? 0) / 2 : y - (bounds?.top ?? 0);
    const left = (scroller?.scrollLeft ?? 0) + anchorX;
    const top = (scroller?.scrollTop ?? 0) + anchorY;
    const ratio = next / zoom();
    setZoom(next);
    if (scroller) {
      scroller.scrollLeft = left * ratio - anchorX;
      scroller.scrollTop = top * ratio - anchorY;
    }
  }
  function release(event: PointerEvent) {
    pointers.delete(event.pointerId);
    gesture = undefined;
    drag = undefined;
  }
  onCleanup(() => pointers.clear());
  return (
    <div class="review-image">
      <div class="comparison-tools">
        <Button
          variant="ghost"
          size="compact"
          disabled={zoom() <= 1}
          onClick={() => scale(zoom() - 0.5)}
        >
          {t("review.zoomOut")}
        </Button>
        <label for="comparison-zoom">{t("review.zoom")}</label>
        <Select
          id="comparison-zoom"
          value={String(zoom())}
          onChange={(event) => scale(Number(event.currentTarget.value))}
        >
          <Show when={![1, 1.5, 2, 3, 4].includes(zoom())}>
            <option value={String(zoom())}>{t("review.zoomTimes", { n: zoom() })}</option>
          </Show>
          <option value="1">{t("review.zoomFit")}</option>
          <option value="1.5">{t("review.zoomTimes", { n: 1.5 })}</option>
          <option value="2">{t("review.zoomTimes", { n: 2 })}</option>
          <option value="3">{t("review.zoomTimes", { n: 3 })}</option>
          <option value="4">{t("review.zoomTimes", { n: 4 })}</option>
        </Select>
        <Button
          variant="ghost"
          size="compact"
          disabled={zoom() >= 4}
          onClick={() => scale(zoom() + 0.5)}
        >
          {t("review.zoomIn")}
        </Button>
      </div>
      <p class="settings-note">{t("review.imageHelp")}</p>
      <Show when={!failed()} fallback={<p>{t("review.imageUnsupported")}</p>}>
        <section
          ref={scroller}
          class="comparison-scroller"
          tabindex="0"
          aria-label={t("review.imageScroller")}
          data-zoom={zoom().toFixed(2)}
          onPointerDown={(event) => {
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            event.currentTarget.setPointerCapture(event.pointerId);
            if (pointers.size === 2) {
              gesture = { distance: distance(), zoom: zoom() };
              drag = undefined;
            } else
              drag = {
                x: event.clientX,
                y: event.clientY,
                left: scroller.scrollLeft,
                top: scroller.scrollTop,
              };
          }}
          onPointerMove={(event) => {
            if (!pointers.has(event.pointerId)) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (gesture && pointers.size === 2 && gesture.distance > 0) {
              const [a, b] = [...pointers.values()];
              if (a && b)
                scale(
                  (gesture.zoom * distance()) / gesture.distance,
                  (a.x + b.x) / 2,
                  (a.y + b.y) / 2,
                );
            } else if (drag) {
              scroller.scrollLeft = drag.left - (event.clientX - drag.x);
              scroller.scrollTop = drag.top - (event.clientY - drag.y);
            }
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              scale(zoom() + 0.5);
            }
            if (event.key === "-") {
              event.preventDefault();
              scale(zoom() - 0.5);
            }
          }}
        >
          <img
            src={props.url}
            alt={t("review.imageAlt")}
            draggable={false}
            style={{ width: `${zoom() * 100}%`, "max-width": "none", display: "block" }}
            onError={() => setFailed(true)}
          />
        </section>
      </Show>
    </div>
  );
}
