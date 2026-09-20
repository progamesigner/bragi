import { createSignal, Show } from "solid-js";

type UploadTarget = {
  uploadId: string;
  target: { url: string; method: "POST" | "PUT"; headers: Record<string, string> };
  expiresAt: string;
};

export default function Home() {
  const [otp, setOtp] = createSignal("");
  const [file, setFile] = createSignal<File>();
  const [status, setStatus] = createSignal("尚未驗證");
  const [busy, setBusy] = createSignal(false);

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

  async function testUpload() {
    const selected = file();
    if (!selected) return;
    setBusy(true);
    setStatus("建立 Gemini upload session…");
    try {
      const sessionResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok) throw new Error(await sessionResponse.text());
      const upload = (await sessionResponse.json()) as UploadTarget;
      setStatus("瀏覽器直接上傳至 Gemini…");
      const response = await fetch(upload.target.url, {
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw new Error(`Gemini upload failed (${response.status})`);
      const receipt = await response.json();
      setStatus(`CORS spike 成功：${receipt.file?.name ?? "upload complete"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <p class="eyebrow">BRAGI · M0</p>
        <h1>
          讓桌上的故事，
          <br />
          用對的語氣開口。
        </h1>
        <p class="lede">
          拍下劇本或卡牌，校對分段，再逐段朗讀。這個畫面目前用來驗證登入與 Gemini browser upload。
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
        <h2>2. Direct upload CORS spike</h2>
        <p>選擇一張不含敏感資訊的圖片。檔案會直接送到 Google Gemini，最多保存 48 小時。</p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          onChange={(e) => setFile(e.currentTarget.files?.[0])}
        />
        <Show when={file()}>
          {(selected) => (
            <p class="file">
              {selected().name} · {(selected().size / 1_000_000).toFixed(2)} MB
            </p>
          )}
        </Show>
        <button type="button" class="wide" disabled={busy() || !file()} onClick={testUpload}>
          執行上傳測試
        </button>
      </section>

      <p class="status" role="status">
        {busy() ? "處理中 · " : ""}
        {status()}
      </p>
    </main>
  );
}
