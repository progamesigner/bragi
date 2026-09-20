import { createSignal, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import Capture from "~/components/Capture";
import Playback from "~/components/Playback";
import Review from "~/components/Review";
import { apiErrorMessage } from "~/lib/api";
import type { PreparedImage } from "~/lib/image";
import type { Segment } from "~/lib/state";
import type { StatusMessage, StatusTone } from "~/lib/status";

type UploadTarget = {
  uploadId: string;
  target: { url: string; method: "POST" | "PUT"; headers: Record<string, string> };
  expiresAt: string;
};

type OcrResult = {
  detectedLanguage: string;
  segments: Segment[];
};

export default function Home() {
  const [otp, setOtp] = createSignal("");
  const [image, setImage] = createSignal<PreparedImage>();
  const [genreHint, setGenreHint] = createSignal("");
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [segments, setSegments] = createStore<Segment[]>([]);
  const [status, setStatus] = createSignal<StatusMessage>({
    message: "尚未驗證",
    tone: "info",
  });
  const [busy, setBusy] = createSignal(false);
  const [screen, setScreen] = createSignal<"review" | "playback">("review");

  function reportStatus(message: string, tone: StatusTone = "info") {
    setStatus({ message, tone });
  }

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp: otp() }),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "驗證失敗"));
      reportStatus("驗證成功，可以上傳圖片", "success");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "驗證失敗", "error");
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
    reportStatus("建立 Gemini upload session…");
    try {
      const sessionResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok)
        throw new Error(await apiErrorMessage(sessionResponse, "無法建立上傳工作階段"));
      const upload = (await sessionResponse.json()) as UploadTarget;
      reportStatus("透過 Bragi 安全轉送至 Gemini…");
      const response = await fetch(upload.target.url, {
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法上傳圖片"));
      const receipt = await response.json();
      reportStatus("Gemini 正在辨識與分段…");
      const ocrResponse = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          receipt,
          genreHint: genreHint().trim() || undefined,
        }),
      });
      if (!ocrResponse.ok) throw new Error(await apiErrorMessage(ocrResponse, "無法辨識圖片"));
      const result = (await ocrResponse.json()) as OcrResult;
      setDetectedLanguage(result.detectedLanguage);
      setSegments(reconcile(result.segments));
      setScreen("review");
      reportStatus(`辨識完成 · ${result.segments.length} 個段落`, "success");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "上傳失敗", "error");
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
          onStatus={reportStatus}
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
                  reportStatus("已返回校對", "success");
                }}
                onStatus={reportStatus}
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
                reportStatus("逐段朗讀已就緒");
              }}
              onStatus={reportStatus}
            />
          </Show>
        )}
      </Show>

      <p
        class="status"
        classList={{ success: status().tone === "success", error: status().tone === "error" }}
        role={status().tone === "error" ? "alert" : "status"}
      >
        {busy() ? "處理中 · " : ""}
        {status().message}
      </p>
    </main>
  );
}
