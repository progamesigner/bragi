# API 與供應商邊界

Bragi 的 API 由同源網頁使用，金鑰與簽章秘密只在伺服器。這裡記錄程式目前的契約；模型預設值由 `.env.example` 與 `src/lib/server/*` 決定。

## 認證與回應

`POST /api/session` 驗證 6 位 TOTP（SHA-1、30 秒週期、前後 1 個週期容許值）。成功後簽發 HS256 JWT，校驗 issuer、audience、有效期與 `BRAGI_SESSION_VERSION`。JWT 與 `__Host-bragi-session` cookie 同為 90 天有效；cookie 使用 `Path=/; HttpOnly; Secure; SameSite=Strict`。

`POST /api/session`、`DELETE /api/session` 以及所有處理圖片／語音的 POST 都要求 `Origin` 與請求 URL 的 origin 完全相同，缺少 Origin 也拒絕。處理圖片／語音的 POST 另要求有效登入。JSON POST 要求 `Content-Type: application/json` 並驗證 body；上傳原始圖片則按簽章憑證驗證 MIME 與大小。

JSON 錯誤格式如下；API 回應均以 `X-Request-Id` 提供追查 ID。供應商錯誤內文不直接回傳。

```json
{ "error": { "code": "INVALID_REQUEST", "message": "…", "requestId": "…", "retryable": false } }
```

常見狀態為 400 輸入無效、401 未登入、403 非同源、413 超限、415 格式不符、422 供應商拒絕、429 額度／速率限制、502 回應無效及 503 服務不可用。429 可帶供應商的 `Retry-After`。取消且尚能回應的請求使用 `499 REQUEST_CANCELLED`；串流已開始後的錯誤會中斷 body，無法再改寫為 JSON 錯誤。

## 端點

| 方法與路徑 | 輸入、輸出與檢查 |
|---|---|
| `GET /api/health` | 公開回傳 `status`、`service`、`requestId`；不呼叫 Gemini |
| `GET /api/session` | 回傳 `authenticated` 及登入後可用的 `voices`，不曝露 JWT |
| `POST /api/session` | `{ otp }`；驗證成功後設定 cookie，回傳登入狀態與聲音 |
| `DELETE /api/session` | 使 cookie 過期；前端在登出流程清除工作區與本機暫存 |
| `POST /api/uploads` | `{ mimeType, sizeBytes }`；支援 JPEG、PNG、WebP、HEIC、HEIF，正整數大小不超過 4,000,000 bytes；回傳簽署的 `uploadId`、上傳 target 與有效期 |
| `POST /api/upload-content` | 圖片 bytes；要求 `x-bragi-upload-id`，校驗 JWT、MIME、實際 byte 數後代理上傳 Gemini；回傳供應商上傳 receipt |
| `POST /api/ocr` | `{ uploadId, receipt, genreHint? }`；驗證 uploadId 及 Gemini Files metadata，回傳 `detectedLanguage` 與結構化 `segments` |
| `POST /api/tts` | `{ text, toneHint?, genreHint?, voice? }`；回傳 `audio/wav`，含 `X-Audio-Duration-Ms` |
| `POST /api/tts-stream` | 同 TTS 輸入；回傳 `audio/L16;rate=24000;channels=1`，含 `X-Audio-Sample-Rate: 24000` |

一般 API 回應使用 `Cache-Control: private, no-store`。瀏覽器仍可能依應用邏輯在記憶體保存完整音訊，與 HTTP cache 不同。

## 圖片與 OCR

瀏覽器先驗證來源不超過 25,000,000 bytes，調整 EXIF 方向，長邊最多 2,400 px，嘗試壓到 4,000,000 bytes 內。無法解碼的 HEIC／HEIF 若原檔已在上傳限制內，可直接傳送；更大檔案須轉檔或重拍。

上傳能力憑證有效 15 分鐘，簽入供應商、MIME、大小與上游 URL，驗證 issuer 與 audience。上傳 URL 必須以 `https://generativelanguage.googleapis.com/` 開頭；瀏覽器只拿到 Bragi 的代理 target，不直接決定上游 URL。

OCR 不信任 receipt 內的 URI。伺服器以受限格式的 file name 查 Gemini Files，再核對名稱、MIME、大小與 ACTIVE 狀態；PROCESSING 回傳可重試的 409，URI 限 HTTPS 與 Gemini 主機。

OCR 預設 `gemini-3.8-flash`，可用 `GEMINI_OCR_MODEL` 覆寫。Interactions 請求使用高解析度圖片、結構化輸出與 `store: false`，回應再次以 schema 驗證。每次 Files lookup 有 10 秒 deadline，OCR 請求有 60 秒 deadline，並合併用戶端斷線訊號。

## 語音

預設 `gemini-3.8-flash-tts`，可用 `GEMINI_TTS_MODEL` 覆寫。伺服器只接受 `src/lib/server/voices.ts` 目錄中的 30 種聲音，預設 Kore；未提供 voice 時使用預設。

文字以逐字稿輸入，語氣與故事類型另放 `speech_metadata` style，避免把指示唸出來。兩條語音路徑都設 `store: false` 並要求 raw `audio/l16`：24 kHz、16-bit、mono PCM，驗證格式與 sample 邊界，最多 60 秒。

語音輸入必須非空，最多 400 字素、2,000 UTF-8 bytes；拒絕不允許的控制字元。語氣最多 120 字素，故事類型最多 80；草稿保存限制另外見 [架構文件](architecture.md)。

完整音訊路徑把 PCM 包成 WAV，總 deadline 55 秒。可重試的暫時錯誤或缺音訊回應最多再試 1 次，間隔約 75 至 175 ms；不能重試的錯誤直接回傳。串流路徑有 55 秒 deadline，解析 Gemini Interactions SSE，只轉送驗證過且受大小限制的 audio delta，不套用完整音訊的重試迴圈。

圖片上傳建立與代理傳送都轉交用戶端取消訊號，但沒有另外加供應商 timeout；Files lookup、OCR 與語音則有上述 deadline。取消只能停止 Bragi 等待與傳送，不能撤回供應商已開始的處理或計費。
