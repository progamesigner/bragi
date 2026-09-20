import { createSignal, onMount, Show } from "solid-js";
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
  const [authBusy, setAuthBusy] = createSignal(false);
  const [sessionChecking, setSessionChecking] = createSignal(true);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [recognitionBusy, setRecognitionBusy] = createSignal(false);
  const [screen, setScreen] = createSignal<"review" | "playback">("review");

  function reportStatus(message: string, tone: StatusTone = "info") {
    setStatus({ message, tone });
  }

  function clearWorkspace() {
    setImage(undefined);
    setDetectedLanguage(undefined);
    setSegments(reconcile([]));
    setScreen("review");
  }

  onMount(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法確認登入狀態"));
      const session = (await response.json()) as { authenticated: boolean };
      setAuthenticated(session.authenticated);
      reportStatus(
        session.authenticated ? "已恢復登入狀態" : "請先使用 Authenticator 驗證碼登入",
        session.authenticated ? "success" : "info",
      );
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "無法確認登入狀態", "error");
    } finally {
      setSessionChecking(false);
    }
  });

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    setAuthBusy(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp: otp() }),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "驗證失敗"));
      setAuthenticated(true);
      setOtp("");
      reportStatus("驗證成功，可以上傳圖片", "success");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "驗證失敗", "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setAuthBusy(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "登出失敗"));
      setAuthenticated(false);
      clearWorkspace();
      reportStatus("已安全登出", "success");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "登出失敗", "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function recognizeUpload() {
    const selected = image()?.file;
    if (!selected) return;
    setRecognitionBusy(true);
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
      setRecognitionBusy(false);
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
        <Show when={!sessionChecking()} fallback={<p>正在確認登入狀態…</p>}>
          <Show
            when={authenticated()}
            fallback={
              <form onSubmit={signIn} aria-busy={authBusy()}>
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
                  <button type="submit" disabled={authBusy() || otp().length !== 6}>
                    {authBusy() ? "驗證中…" : "登入"}
                  </button>
                </div>
              </form>
            }
          >
            <div class="session-state">
              <p>這台裝置已登入，session 最長保留 90 天。</p>
              <button type="button" class="small secondary" disabled={authBusy()} onClick={signOut}>
                {authBusy() ? "登出中…" : "登出"}
              </button>
            </div>
          </Show>
        </Show>
      </section>

      <Show when={authenticated()}>
        <section class="card" aria-busy={recognitionBusy()}>
          <h2>2. 上傳並辨識</h2>
          <p>
            拍攝或選擇一張不含敏感資訊的圖片。Bragi 會在裝置上調整方向、尺寸與檔案大小，再轉送至
            Google Gemini，最多保存 48 小時。
          </p>
          <aside class="privacy-note" id="upload-privacy" aria-labelledby="privacy-heading">
            <h3 id="privacy-heading">資料如何處理</h3>
            <ul>
              <li>照片的方向修正與壓縮先在此裝置完成。</li>
              <li>照片與朗讀文字會送往 Google Gemini；照片最多保存 48 小時。</li>
              <li>Bragi 不建立辨識歷史，也不把產生的音訊存入資料庫。</li>
            </ul>
            <p>請避免拍入無關的人臉、聯絡資訊或其他敏感資料。</p>
          </aside>
          <Capture
            disabled={recognitionBusy()}
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
          <button
            type="button"
            class="wide"
            disabled={recognitionBusy() || !image()}
            onClick={recognizeUpload}
          >
            {recognitionBusy() ? "正在上傳與辨識…" : "上傳並辨識文字"}
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
      </Show>

      <p
        class="status"
        classList={{ success: status().tone === "success", error: status().tone === "error" }}
        role={status().tone === "error" ? "alert" : "status"}
      >
        {status().message}
      </p>
    </main>
  );
}
