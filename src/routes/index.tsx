import { createSignal, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import Capture from "~/components/Capture";
import Playback from "~/components/Playback";
import Review from "~/components/Review";
import type { PreparedImage } from "~/lib/image";
import type { Segment } from "~/lib/state";

type UploadTarget = {
  uploadId: string;
  target: { url: string; method: "POST" | "PUT"; headers: Record<string, string> };
  expiresAt: string;
};

type OcrResult = {
  detectedLanguage: string;
  segments: Segment[];
};

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return `${body.error?.message ?? "Request failed"} (${body.error?.requestId ?? response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export default function Home() {
  const [otp, setOtp] = createSignal("");
  const [image, setImage] = createSignal<PreparedImage>();
  const [genreHint, setGenreHint] = createSignal("");
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [segments, setSegments] = createStore<Segment[]>([]);
  const [status, setStatus] = createSignal("尚未驗證");
  const [busy, setBusy] = createSignal(false);
  const [screen, setScreen] = createSignal<"review" | "playback">("review");

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp: otp() }),
      });
      setStatus(response.ok ? "驗證成功，可以測試直接上傳" : "驗證失敗");
    } finally {
      setBusy(false);
    }
  }

  async function recognizeUpload() {
    const selected = image()?.file;
    if (!selected) return;
    setBusy(true);
    setDetectedLanguage(undefined);
    setSegments(reconcile([]));
    setStatus("建立 Gemini upload session…");
    try {
      const sessionResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok) throw new Error(await responseError(sessionResponse));
      const upload = (await sessionResponse.json()) as UploadTarget;
      setStatus("透過 Bragi 安全轉送至 Gemini…");
      const response = await fetch(upload.target.url, {
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const receipt = await response.json();
      setStatus("Gemini 正在辨識與分段…");
      const ocrResponse = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          receipt,
          genreHint: genreHint().trim() || undefined,
        }),
      });
      if (!ocrResponse.ok) throw new Error(await responseError(ocrResponse));
      const result = (await ocrResponse.json()) as OcrResult;
      setDetectedLanguage(result.detectedLanguage);
      setSegments(reconcile(result.segments));
      setScreen("review");
      setStatus(`辨識完成 · ${result.segments.length} 個段落`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <p class="eyebrow">BRAGI · OCR</p>
        <h1>
          讓桌上的故事，
          <br />
          用對的語氣開口。
        </h1>
        <p class="lede">
          拍下劇本或卡牌，交給 Gemini 辨識與分段。辨識結果仍是草稿，朗讀前請務必校對。
        </p>
      </header>

      <section class="card">
        <h2>1. 驗證存取</h2>
        <form onSubmit={signIn}>
          <label for="otp">Authenticator 6 位驗證碼</label>
          <div class="row">
            <input
              id="otp"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]{6}"
              value={otp()}
              onInput={(e) => setOtp(e.currentTarget.value)}
            />
            <button type="submit" disabled={busy() || otp().length !== 6}>
              登入
            </button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2>2. 上傳並辨識</h2>
        <p>
          拍攝或選擇一張不含敏感資訊的圖片。Bragi 會在裝置上調整方向、尺寸與檔案大小，再轉送至
          Google Gemini，最多保存 48 小時。
        </p>
        <Capture
          disabled={busy()}
          onChange={(prepared) => {
            setImage(prepared);
            setDetectedLanguage(undefined);
            setSegments(reconcile([]));
            setScreen("review");
          }}
          onStatus={setStatus}
        />
        <label for="genre">題材提示（選填）</label>
        <input
          id="genre"
          type="text"
          maxlength="80"
          placeholder="例如：奇幻、懸疑、科幻"
          value={genreHint()}
          onInput={(event) => setGenreHint(event.currentTarget.value)}
        />
        <button type="button" class="wide" disabled={busy() || !image()} onClick={recognizeUpload}>
          上傳並辨識文字
        </button>
      </section>

      <Show when={detectedLanguage()}>
        {(language) => (
          <Show
            when={screen() === "review"}
            fallback={
              <Playback
                segments={segments}
                genreHint={genreHint().trim() || undefined}
                onBack={() => {
                  setScreen("review");
                  setStatus("已返回校對");
                }}
                onStatus={setStatus}
              />
            }
          >
            <Review
              detectedLanguage={language()}
              genreHint={genreHint().trim() || undefined}
              segments={segments}
              setSegments={setSegments}
              onStartPlayback={() => {
                setScreen("playback");
                setStatus("逐段朗讀已就緒");
              }}
              onStatus={setStatus}
            />
          </Show>
        )}
      </Show>

      <p class="status" role="status">
        {busy() ? "處理中 · " : ""}
        {status()}
      </p>
    </main>
  );
}
