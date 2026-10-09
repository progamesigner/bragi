import { batch, createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import Capture from "~/components/Capture";
import Playback from "~/components/Playback";
import Review from "~/components/Review";
import VoiceSample from "~/components/VoiceSample";
import { apiErrorMessage } from "~/lib/api";
import { DraftAutosave } from "~/lib/autosave";
import { type Draft, MAX_DRAFT_BYTES, parseDraft, serializeDraft } from "~/lib/draft";
import { graphemeCount, MAX_DRAFT_GENRE } from "~/lib/draft-limits";
import { History } from "~/lib/editing";
import type { PreparedImage } from "~/lib/image";
import { networkErrorMessage, requireOnline } from "~/lib/network";
import { ocrResponseSchema } from "~/lib/schemas";
import { speechCache } from "~/lib/speech-cache";
import type { Segment } from "~/lib/state";
import type { StatusMessage, StatusTone } from "~/lib/status";
import { voiceLabel } from "~/lib/voices";
import { commitCandidate, WorkspaceRevision } from "~/lib/workspace";

type UploadTarget = {
  uploadId: string;
  target: { url: string; method: "POST" | "PUT"; headers: Record<string, string> };
  expiresAt: string;
};

export default function Home() {
  const [voice, setVoice] = createSignal<string>();
  const [voices, setVoices] = createSignal<string[]>([]);
  const [fontSize, setFontSize] = createSignal("normal");
  const [online, setOnline] = createSignal(true);
  const [workspace, setWorkspace] = createSignal({});
  const [requestRevision, setRequestRevision] = createSignal({});
  const operations = new WorkspaceRevision();
  const authOperations = new WorkspaceRevision();
  const autosave = new DraftAutosave(() => localStorage);
  const [autosaveReady, setAutosaveReady] = createSignal(false);
  const [savedDraft, setSavedDraft] = createSignal<Draft>();
  const [otp, setOtp] = createSignal("");
  const [image, setImage] = createSignal<PreparedImage>();
  const [candidate, setCandidate] = createSignal<PreparedImage>();
  const [candidateActive, setCandidateActive] = createSignal(false);
  const [candidateGenre, setCandidateGenre] = createSignal("");
  const [genreHint, setGenreHint] = createSignal("");
  const [detectedLanguage, setDetectedLanguage] = createSignal<string>();
  const [editHistory, setEditHistory] = createSignal(new History<Segment[]>([]));
  const [segments, setSegments] = createStore<Segment[]>([]);
  const [status, setStatus] = createSignal<StatusMessage>({ message: "尚未驗證", tone: "info" });
  const [authBusy, setAuthBusy] = createSignal(false);
  const [sessionChecking, setSessionChecking] = createSignal(true);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [recognitionBusy, setRecognitionBusy] = createSignal(false);
  const [screen, setScreen] = createSignal<"review" | "playback">("review");

  const currentDraft = (): Draft => ({
    detectedLanguage: detectedLanguage() ?? "未指定",
    genreHint: genreHint() || undefined,
    segments: segments.map((segment) => ({ ...segment })),
  });

  createEffect(() => {
    if (!autosaveReady() || !detectedLanguage()) return;
    autosave.schedule(currentDraft());
  });

  function restoreVoice(available: string[]) {
    setVoices(available);
    try {
      const saved = localStorage.getItem("bragi-voice");
      setVoice(saved && available.includes(saved) ? saved : undefined);
    } catch {}
  }

  function reportStatus(message: string, tone: StatusTone = "info") {
    setStatus({ message, tone });
  }

  function cancelOperation() {
    operations.invalidate();
    setRequestRevision({});
    setRecognitionBusy(false);
  }

  function clearWorkspace() {
    cancelOperation();
    autosave.clear();
    batch(() => {
      speechCache.clear();
      setImage(undefined);
      setCandidate(undefined);
      setCandidateActive(false);
      setCandidateGenre("");
      setSavedDraft(undefined);
      setDetectedLanguage(undefined);
      setSegments(reconcile([]));
      setEditHistory(new History<Segment[]>([]));
      setScreen("review");
      setGenreHint("");
      setWorkspace({});
    });
  }

  function applyDraft(draft: Draft, prepared?: PreparedImage) {
    batch(() => {
      speechCache.clear();
      setImage(prepared);
      setCandidate(undefined);
      setCandidateActive(false);
      setGenreHint(draft.genreHint ?? "");
      setCandidateGenre(draft.genreHint ?? "");
      setSavedDraft(undefined);
      setSegments(reconcile(draft.segments));
      setEditHistory(new History<Segment[]>(draft.segments));
      setDetectedLanguage(draft.detectedLanguage);
      setScreen("review");
      // Recreate the view even when the new draft has the same detected language.
      setWorkspace({});
    });
    autosave.save(draft);
  }

  onMount(() => {
    setSavedDraft(autosave.load());
    setAutosaveReady(true);
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
    });
  });

  onCleanup(() => {
    operations.invalidate();
    authOperations.invalidate();
    autosave.dispose();
  });

  onMount(async () => {
    const operation = authOperations.begin();
    try {
      const response = await fetch("/api/session", { cache: "no-store", signal: operation.signal });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法確認登入狀態"));
      const session = (await response.json()) as { authenticated: boolean; voices?: string[] };
      if (!operation.current()) return;
      setAuthenticated(session.authenticated);
      restoreVoice(session.voices ?? []);
      reportStatus(
        session.authenticated ? "已恢復登入狀態" : "請先使用 Authenticator 驗證碼登入",
        session.authenticated ? "success" : "info",
      );
    } catch (error) {
      if (operation.current())
        reportStatus(error instanceof Error ? error.message : "無法確認登入狀態", "error");
    } finally {
      if (operation.current()) setSessionChecking(false);
    }
  });

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    const operation = authOperations.begin();
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", {
        signal: operation.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp: otp() }),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "驗證失敗"));
      const session = await response.json();
      if (!operation.current()) return;
      restoreVoice(session.voices ?? []);
      setAuthenticated(true);
      setOtp("");
      reportStatus("驗證成功，可以上傳圖片", "success");
    } catch (error) {
      if (operation.current()) reportStatus(networkErrorMessage(error, "驗證失敗"), "error");
    } finally {
      if (operation.current()) setAuthBusy(false);
    }
  }

  async function signOut() {
    const operation = authOperations.begin();
    cancelOperation();
    // Unmount pending image/audio operations while the logout request is in flight.
    setWorkspace({});
    setCandidate(undefined);
    autosave.clear();
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", { method: "DELETE", signal: operation.signal });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "登出失敗"));
      if (!operation.current()) return;
      setAuthenticated(false);
      clearWorkspace();
      reportStatus("已安全登出", "success");
    } catch (error) {
      if (operation.current()) reportStatus(networkErrorMessage(error, "登出失敗"), "error");
    } finally {
      if (operation.current()) setAuthBusy(false);
    }
  }

  async function importDraft(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    cancelOperation();
    const operation = operations.begin();
    try {
      if (file.size > MAX_DRAFT_BYTES) throw new Error("草稿檔案超過 200 KB，無法匯入");
      const source = await file.text();
      if (!operation.current()) return;
      const draft = parseDraft(source);
      if (
        !commitCandidate(
          operation,
          draft,
          !!detectedLanguage(),
          () => window.confirm("匯入草稿會取代目前的圖片、校閱文字與音訊，確定要繼續嗎？"),
          (next) => {
            setCandidate(undefined);
            applyDraft(next);
          },
        )
      )
        return;
      reportStatus(`已匯入草稿 · ${draft.segments.length} 個段落`, "success");
    } catch (error) {
      if (operation.current())
        reportStatus(error instanceof Error ? error.message : "無法匯入草稿", "error");
    }
  }

  async function recognizeUpload() {
    const prepared = candidate();
    if (!prepared) return;
    const selected = prepared.file;
    const genre = candidateGenre();
    const operation = operations.begin();
    setRecognitionBusy(true);
    setRequestRevision({});
    reportStatus("建立 Gemini upload session…");
    try {
      requireOnline();
      const sessionResponse = await fetch("/api/uploads", {
        signal: operation.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok)
        throw new Error(await apiErrorMessage(sessionResponse, "無法建立上傳工作階段"));
      const upload = (await sessionResponse.json()) as UploadTarget;
      if (!operation.current()) return;
      reportStatus("透過 Bragi 安全轉送至 Gemini…");
      const response = await fetch(upload.target.url, {
        signal: operation.signal,
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "無法上傳圖片"));
      const receipt = await response.json();
      if (!operation.current()) return;
      reportStatus("Gemini 正在辨識與分段…");
      const ocrResponse = await fetch("/api/ocr", {
        signal: operation.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          receipt,
          genreHint: genre.trim() || undefined,
        }),
      });
      if (!ocrResponse.ok) throw new Error(await apiErrorMessage(ocrResponse, "無法辨識圖片"));
      const value: unknown = await ocrResponse.json();
      if (!operation.current()) return;
      const parsed = ocrResponseSchema.safeParse(value);
      if (!parsed.success) throw new Error("辨識結果格式不正確，請重試");
      const draft: Draft = { ...parsed.data, genreHint: genre || undefined };
      if (
        !commitCandidate(
          operation,
          draft,
          !!detectedLanguage(),
          () => window.confirm("辨識完成；新稿件會取代目前的圖片、校閱文字與音訊，確定要繼續嗎？"),
          (next) => applyDraft(next, prepared),
        )
      ) {
        if (operation.current()) reportStatus("已保留目前稿件；候選圖片可重新辨識");
        return;
      }
      reportStatus(`辨識完成 · ${draft.segments.length} 個段落`, "success");
    } catch (error) {
      if (operation.current()) reportStatus(networkErrorMessage(error, "上傳失敗"), "error");
    } finally {
      if (operation.current()) setRecognitionBusy(false);
    }
  }

  function editGenre(input: HTMLInputElement) {
    const value = input.value;
    try {
      if (graphemeCount(value) > MAX_DRAFT_GENRE) throw new Error("題材提示最多 80 字");
      if (candidateActive()) setCandidateGenre(value);
      else {
        if (detectedLanguage())
          serializeDraft({ ...currentDraft(), genreHint: value || undefined });
        setGenreHint(value);
        setCandidateGenre(value);
      }
    } catch (error) {
      input.value = candidateActive() ? candidateGenre() : genreHint();
      reportStatus(error instanceof Error ? error.message : "無法修改題材", "error");
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
              try {
                localStorage.setItem("bragi-voice", voice() ?? "");
              } catch {}
            }}
          >
            <option value="">預設聲音（{voiceLabel(voices()[0] ?? "")}）</option>
            <For each={voices().slice(1)}>
              {(value) => <option value={value}>{voiceLabel(value)}</option>}
            </For>
          </select>
          <Show when={workspace()} keyed>
            <VoiceSample
              voice={voice() ?? voices()[0]}
              requestRevision={requestRevision()}
              onStatus={reportStatus}
            />
          </Show>
        </Show>
      </section>
      <Show when={!online()}>
        <p role="status">目前離線。已載入的文字與音訊仍可使用；連線恢復後請手動重試。</p>
      </Show>
      <Show
        when={
          authenticated() &&
          !sessionChecking() &&
          !authBusy() &&
          savedDraft() &&
          !detectedLanguage()
        }
      >
        <section class="card" aria-label="本機暫存草稿">
          <p>此裝置有上次的文字草稿，可恢復繼續校對。</p>
          <button
            type="button"
            class="small"
            onClick={() => {
              if (!authenticated() || sessionChecking() || authBusy() || detectedLanguage()) return;
              const draft = savedDraft();
              if (!draft) return;
              cancelOperation();
              setCandidate(undefined);
              applyDraft(draft);
              reportStatus("已恢復上次的草稿，未傳送至 Gemini", "success");
            }}
          >
            恢復上次的草稿
          </button>
          <button
            type="button"
            class="small secondary"
            onClick={() => {
              autosave.clear();
              setSavedDraft(undefined);
            }}
          >
            捨棄
          </button>
        </section>
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
            disabled={authBusy()}
            onSelect={() => {
              cancelOperation();
              setCandidate(undefined);
              setCandidateActive(true);
              setCandidateGenre(genreHint());
              return operations.begin();
            }}
            onCancel={() => {
              cancelOperation();
              setCandidate(undefined);
              setCandidateActive(false);
              reportStatus("已取消候選圖片，目前稿件已保留");
            }}
            onChange={(prepared) => {
              setCandidate(prepared);
            }}
            onStatus={reportStatus}
          />
          <label for="genre">題材提示（選填）</label>
          <input
            id="genre"
            type="text"
            placeholder="例如：奇幻、懸疑、科幻"
            disabled={recognitionBusy() || authBusy()}
            value={candidateActive() ? candidateGenre() : genreHint()}
            onInput={(event) => editGenre(event.currentTarget)}
          />
          <button
            type="button"
            class="wide"
            disabled={recognitionBusy() || !candidate() || authBusy()}
            onClick={recognizeUpload}
          >
            {recognitionBusy() ? "正在上傳與辨識…" : "上傳並辨識文字"}
          </button>
          <div class="draft-import">
            <label
              class="file-button secondary small"
              for="draft-import"
              aria-disabled={authBusy()}
            >
              匯入草稿 JSON
            </label>
            <input
              id="draft-import"
              class="visually-hidden"
              type="file"
              aria-describedby="draft-import-note"
              accept="application/json,.json"
              disabled={authBusy()}
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
                  requestRevision={requestRevision()}
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
                requestRevision={requestRevision()}
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
