import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import Capture from "~/components/Capture";
import Playback from "~/components/Playback";
import Review from "~/components/Review";
import { apiErrorMessage } from "~/lib/api";
import { MAX_DRAFT_BYTES, parseDraft } from "~/lib/draft";
import { History } from "~/lib/editing";
import type { PreparedImage } from "~/lib/image";
import { networkErrorMessage, requireOnline } from "~/lib/network";
import { speechCache } from "~/lib/speech-cache";
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
  const [voice, setVoice] = createSignal<string>();
  const [voices, setVoices] = createSignal<string[]>([]);
  const [fontSize, setFontSize] = createSignal("normal");
  const [online, setOnline] = createSignal(true);
  const [workspace, setWorkspace] = createSignal({});
  let recognitionRequest: AbortController | undefined;
  const [otp, setOtp] = createSignal("");
  const [image, setImage] = createSignal<PreparedImage>();
  const [genreHint, setGenreHint] = createSignal("");
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [editHistory, setEditHistory] = createSignal(new History<Segment[]>([]));
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
    recognitionRequest?.abort();
    recognitionRequest = undefined;
    setRecognitionBusy(false);
    speechCache.clear();
    setImage(undefined);
    setDetectedLanguage(undefined);
    setSegments(reconcile([]));
    setEditHistory(new History<Segment[]>([]));
    setScreen("review");
    setGenreHint("");
    setWorkspace({});
  }

  onMount(() => {
    try {
      const saved = localStorage.getItem("bragi-font-size");
      if (saved && ["normal", "large", "largest"].includes(saved)) setFontSize(saved);
    } catch {}
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    onCleanup(() => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      recognitionRequest?.abort();
    });
  });

  onMount(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法確認登入狀態"));
      const session = (await response.json()) as { authenticated: boolean; voices?: string[] };
      setAuthenticated(session.authenticated);
      setVoices(session.voices ?? []);
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
      requireOnline();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp: otp() }),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "驗證失敗"));
      const session = await response.json();
      setVoices(session.voices ?? []);
      setAuthenticated(true);
      setOtp("");
      reportStatus("驗證成功，可以上傳圖片", "success");
    } catch (error) {
      reportStatus(networkErrorMessage(error, "驗證失敗"), "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "登出失敗"));
      setAuthenticated(false);
      clearWorkspace();
      reportStatus("已安全登出", "success");
    } catch (error) {
      reportStatus(networkErrorMessage(error, "登出失敗"), "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function importDraft(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_DRAFT_BYTES) throw new Error("草稿檔案超過 200 KB，無法匯入");
      const draft = parseDraft(await file.text());
      if (
        (detectedLanguage() || image()) &&
        !window.confirm("匯入草稿會取代目前的圖片、校閱文字與音訊，確定要繼續嗎？")
      )
        return;
      clearWorkspace();
      setGenreHint(draft.genreHint ?? "");
      setSegments(reconcile(draft.segments));
      setEditHistory(new History<Segment[]>(draft.segments));
      setDetectedLanguage(draft.detectedLanguage);
      reportStatus(`已匯入草稿 · ${draft.segments.length} 個段落`, "success");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : "無法匯入草稿", "error");
    }
  }

  async function recognizeUpload() {
    const selected = image()?.file;
    if (!selected) return;
    const controller = new AbortController();
    recognitionRequest?.abort();
    recognitionRequest = controller;
    setRecognitionBusy(true);
    setDetectedLanguage(undefined);
    setSegments(reconcile([]));
    setEditHistory(new History<Segment[]>([]));
    reportStatus("建立 Gemini upload session…");
    try {
      requireOnline();
      const sessionResponse = await fetch("/api/uploads", {
        signal: controller.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok)
        throw new Error(await apiErrorMessage(sessionResponse, "無法建立上傳工作階段"));
      const upload = (await sessionResponse.json()) as UploadTarget;
      controller.signal.throwIfAborted();
      reportStatus("透過 Bragi 安全轉送至 Gemini…");
      const response = await fetch(upload.target.url, {
        signal: controller.signal,
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法上傳圖片"));
      const receipt = await response.json();
      controller.signal.throwIfAborted();
      reportStatus("Gemini 正在辨識與分段…");
      const ocrResponse = await fetch("/api/ocr", {
        signal: controller.signal,
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
      controller.signal.throwIfAborted();
      setDetectedLanguage(result.detectedLanguage);
      setSegments(reconcile(result.segments));
      setEditHistory(new History<Segment[]>(result.segments));
      setScreen("review");
      reportStatus(`辨識完成 · ${result.segments.length} 個段落`, "success");
    } catch (error) {
      if (controller.signal.aborted) return;
      reportStatus(networkErrorMessage(error, "上傳失敗"), "error");
    } finally {
      if (recognitionRequest === controller) setRecognitionBusy(false);
    }
  }

  return (
    <main data-font-size={fontSize()}>
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

      <section class="card">
        <label for="font-size">朗讀字級</label>
        <select
          id="font-size"
          value={fontSize()}
          onChange={(event) => {
            setFontSize(event.currentTarget.value);
            try {
              localStorage.setItem("bragi-font-size", fontSize());
            } catch {}
          }}
        >
          <option value="normal">標準</option>
          <option value="large">大</option>
          <option value="largest">特大</option>
        </select>
        <Show when={authenticated() && voices().length > 1}>
          <label for="voice">朗讀聲音</label>
          <select
            id="voice"
            disabled={screen() === "playback" || recognitionBusy()}
            value={voice() ?? ""}
            onChange={(event) => {
              speechCache.clear();
              setVoice(event.currentTarget.value || undefined);
            }}
          >
            <option value="">預設聲音</option>
            <For each={voices()}>{(value) => <option value={value}>{value}</option>}</For>
          </select>
        </Show>
      </section>
      <Show when={!online()}>
        <p role="status">目前離線。已載入的文字與音訊仍可使用；連線恢復後請手動重試。</p>
      </Show>
      <Show when={authenticated() && workspace()} keyed>
        <button
          type="button"
          class="small secondary"
          onClick={() => {
            if (!window.confirm("清除目前圖片、校閱文字與音訊？此操作無法復原，但會保留登入狀態。"))
              return;
            clearWorkspace();
            reportStatus("已清除目前內容，登入狀態已保留", "success");
          }}
        >
          清除目前內容
        </button>
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
              speechCache.clear();
              setImage(prepared);
              setDetectedLanguage(undefined);
              setSegments(reconcile([]));
              setEditHistory(new History<Segment[]>([]));
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
          <div class="draft-import">
            <label
              class="file-button secondary small"
              for="draft-import"
              aria-disabled={recognitionBusy()}
            >
              匯入草稿 JSON
            </label>
            <input
              id="draft-import"
              class="visually-hidden"
              type="file"
              aria-describedby="draft-import-note"
              accept="application/json,.json"
              disabled={recognitionBusy()}
              onChange={(event) => void importDraft(event.currentTarget)}
            />
            <p id="draft-import-note">草稿只含文字與語氣，不含圖片或音訊，也不會上傳到 Gemini。</p>
          </div>
        </section>

        <Show when={detectedLanguage()}>
          {(language) => (
            <Show
              when={screen() === "review"}
              fallback={
                <Playback
                  segments={segments}
                  genreHint={genreHint().trim() || undefined}
                  voice={voice()}
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
                image={image()?.file}
                genreHint={genreHint().trim() || undefined}
                voice={voice()}
                segments={segments}
                setSegments={setSegments}
                history={editHistory()}
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
