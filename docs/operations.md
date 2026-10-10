# 部署、PWA 與維運

驗證分三層：CI、手動執行的音訊瀏覽器測試，以及還沒完成的真機驗收。正式站是 [bragi.0x148.com](https://bragi.0x148.com)。

## Build 與驗收

使用 Node.js 24 與 `npm ci`。CI 執行 check、typecheck、Vitest、安裝 Chromium 與 Noto CJK、Playwright E2E，再 build Vercel 產物。完整指令見 [README](../README.md#測試與驗證)。

- `npm run test:e2e` 使用 `playwright.config.ts`，自行 build 並執行 `.output/server/index.mjs`。預設 port 4173，可用 `BRAGI_E2E_PORT=4194` 覆寫，預設 4 workers，沒有自動 retry。
- 手機流程、手機／平板視覺與 PWA 是不同 projects。一般測試阻擋 service worker，PWA project 允許它。測試使用合成 API 回應，不需要真實 Gemini 憑證或額度。
- 視覺基準使用系統的 Noto CJK 字型，Ubuntu 上先執行 `sudo apt-get install -y fonts-noto-cjk`。缺字型造成的差異要補字型解決，不要更新截圖。截圖前會移開游標、隱藏 toast，並等字型與圖片載入完成；toast 本身另有固定時鐘拍攝的基準。
- 獨立音訊測試：`npx playwright test --config playwright.audio-core.config.ts`，固定 port 4188。先以 `npx playwright install --with-deps chromium webkit` 安裝瀏覽器；涵蓋 Chromium 的 2 種手勢政策與 WebKit，輸出 `test-results/audio-core-results.json`。目前 CI 未執行這份設定。
- iOS Safari、Android Chrome、安裝版 PWA、來電／鎖屏／切 App 與輔助工具依 [真機清單](reading-device-checklist.md) 驗收；清單是待驗步驟，不是通過紀錄。

Vercel build：

```sh
NITRO_PRESET=vercel VERCEL=1 VERCEL_ENV=production npm run build
test -s .vercel/output/static/sw.js
```

平台需配置 `.env.example` 所列伺服器變數，正式站使用 HTTPS。`BRAGI_SESSION_VERSION` 變更會使舊登入失效；登入 cookie 為 90 天有效。金鑰與 session secret 不放進 git 或公開 build 資產。

部署後執行 `BRAGI_SMOKE_URL=https://bragi.0x148.com npm run test:smoke`。smoke 驗證健康端點與未登入的公開畫面，不生成 OCR／語音；另可在本機用 `npm run preview` 檢視 build。

## PWA 產物與更新

`assets/icon/icon.svg` 與 `icon-maskable.svg` 是圖示來源。maskable 圖案保留在中央 80% 圓內；執行 `node scripts/build-icons.mjs`，以已安裝的 Playwright Chromium 產生 `public/` 的 PNG、Apple touch icon 與 favicon。`scripts/pwa-assets.mjs` 列出 precache 公開檔案。

`public/voice-samples/` 是 7 種語言 × 30 種聲音的預產試聽檔（AAC、48 kbps mono），由 `scripts/build-voice-samples.mjs` 呼叫 Gemini 產生後提交。它們不進 precache，也不需要登入；缺檔時前端退回 `/api/tts`。

`build-worker.mjs` 依公開資產及 client JS／CSS 的內容 hash 產生版本化 `bragi-shell-*` 快取。安裝取公開資產時不帶憑證；啟用後刪除舊 shell cache。

service worker 不攔截 API、跨來源、非 GET 或有 query 的請求。公開 precache 資產由 cache 提供；只有 `/` 的離線導覽會落到 `/offline.html`。它不提供離線辨識或新音訊生成，也不把圖片、草稿或音訊存入 Cache Storage；文字草稿另由 localStorage 暫存。

等待中的更新需要確認後啟用並重新載入；若有多個 Bragi 視窗，要求先關閉其他分頁。內容可能遺失時先提供匯出確認，不應依賴記憶體中的圖片或音訊跨更新保存。

## 日誌與指標

`src/lib/server/observability.ts` 的 JSON 事件為 `bragi.request`，包含：

- `time`、`endpoint`、`method`、`requestId`、允許格式的 `model`、HTTP `status`。
- `latencyMs`、分桶的 `inputSize`，及語音路徑的 `audioSeconds`。
- 合法的 `purpose`（preview／playback／prefetch）、`streaming` 與 `outcome`。

outcome 區分 complete、error、cancelled、interrupted。語音會等 body 完成、取消或中斷再記錄；WAV 計算音訊長度時扣掉 44-byte header。health 與 session DELETE 沒有套用此 request observer。

瀏覽器的 `bragi.audio-cache` 只記 hit／miss／pending 與用途。JSON 事件不包含圖片、逐字稿、登入秘密、上傳能力憑證或供應商錯誤內文。端點也可能輸出固定訊息、狀態碼或錯誤分類，不輸出供應商原始錯誤。

把匯出的 JSON log lines 傳給彙整器：

```sh
npm run metrics < requests.jsonl
```

它統計請求數、錯誤、429、p95 延遲、音訊長度，以及輸入日誌中全站每 10 分鐘的 POST 尖峰量（以全站計，不分 IP）。這些數字用於維運觀察，不能當成帳單估算，也沒有接上任何告警。

## 資料保存與排查

Bragi 沒有伺服器端稿件歷史庫。瀏覽器保留文字暫存、裝置偏好及登入 cookie，圖片與音訊只在工作區記憶體。清除、登出或捨棄暫存會刪除本機草稿，偏好另行保存；localStorage 失敗會容錯，不保證可恢復。

Gemini Files 上傳保存 48 小時，見 [官方 Files 文件](https://ai.google.dev/gemini-api/docs/files)。程式對 Interactions 設 `store: false`，不代表上傳檔案立即消失，也不取代供應商資料政策。清除或登出沒有呼叫 Gemini delete。

遇到 API 錯誤，保留畫面上的 request ID，對照 `X-Request-Id` 與伺服器日誌。離線後要手動重試；取消會傳遞到上游，但無法撤回已開始的工作或計費。超長文字要拆段，完整音訊超過 60 秒也會拒絕。播放手勢、seek 與系統中斷的檢查見真機清單。
