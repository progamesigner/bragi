# Bragi

Bragi 是手機優先的桌遊口白助手。拍下劇本或卡牌，交給 Gemini 辨識，校對文字後逐段朗讀。每段播完都會停下，等主持人決定何時繼續。

正式站：[bragi.0x148.com](https://bragi.0x148.com)。登入需要管理者提供的 TOTP 驗證碼設定。

## 功能概覽

流程分成取圖、校對、朗讀三個畫面，播完最後一段後進入完成頁。

- 拍照或選擇圖片，也可以匯入先前匯出的 JSON 草稿。
- 校對卡預設只顯示口白，可以直接修改。展開後能改語氣與發音修正，也能拆分、合併、新增或刪除段落。段落列表可快速跳到要改的位置，編輯可以復原與重做。
- 設定面板可調字級、外觀（深色、淺色或跟隨系統）、介面語言、聲音、語速與朗讀時螢幕常亮。聲音選擇器列出 30 種聲音並可試聽，預設是 Kore。
- 介面有繁體中文、簡體中文、日文、韓文、英文、德文與西班牙文。切換介面語言不會翻譯稿件。繁中以外的譯文還沒經母語者校對，用語見 [用語表](docs/i18n-glossary.md)。

## 使用流程

先登入，再取圖與辨識。每段文字確認後進入朗讀；回到校對時，稿件與編輯位置都會保留。

1. 在 `/` 拍照或選圖，可填故事類型提示，再按辨識。辨識中可以取消。也可以直接匯入草稿，這不會呼叫 Gemini。
2. 在 `/review` 對照原圖修正段落。發音修正只改實際朗讀的文字，畫面上的口白保留原文。每段都能試聽；空白或過長的段落要先修好，才能進入朗讀。
3. 在 `/play` 點一次「播放此段」，音訊準備好就開始播放。每段結束都會停下；上一段與下一段只換位置，不會自動發聲。瀏覽器擋下播放時，點「點一下播放」會沿用已準備好的音訊。暫停或被系統中斷後，可以從原位置繼續。
4. 整段音訊準備完成後，可以用進度滑桿跳到段內任一位置。串流還沒結束時不能拖動。主朗讀、校對試聽與聲音試聽共用同一個播放控制，同一時間只會有一個聲音。
5. 最後一段播完後進入 `/finished`，顯示播了幾段與累計長度。可以在這裡匯出稿件、開始新故事、從頭再唸或回到校對。用瀏覽器上一頁回到朗讀時不會自動播放。

停止編輯約 1 秒後，草稿會暫存在這台裝置的瀏覽器。重新載入並登入後，可以選「恢復上次的草稿」或捨棄。恢復的只有文字，不含圖片與音訊；要長期保存或換裝置，請匯出 JSON 草稿。

換圖、重新辨識、匯入、清除、登出或套用更新時，如果內容會遺失，畫面會先要求確認，並提供「先匯出」。按了先匯出之後，要確認檔案已存好，再另外按繼續；取消則保留目前稿件。清除內容不會登出，但會刪除本機草稿暫存，登出和捨棄暫存也會刪除它。

鍵盤操作如下。設定或對話框開著、或輸入法正在選字時，這些快捷鍵不會作用。

- 校對：Ctrl／Cmd + Z 復原，Ctrl／Cmd + Shift + Z 或 Ctrl + Y 重做。在輸入欄裡會先用瀏覽器本身的文字復原。
- 朗讀：Space 播放或暫停，← 與 → 換段並停止聲音。焦點在按鈕或滑桿上時，按鍵照該控制的原本行為；長按不會連續觸發。
- 進度滑桿：方向鍵、Home、End 調整段內位置，暫停時調整仍維持暫停。

新的聲音與語速從下一次播放或重播開始使用；繼續播放暫停中的音訊時沿用原本的設定。設定裡的聲音試聽固定以 1× 播放。語速有 0.75×、1×、1.25×、1.5×：1× 可以邊生成邊播放，其他語速要等整段音訊生成完，播放時保持原本音高。

## 本機開發

需要 Node.js 24。金鑰只放在伺服器環境變數，不寫進原始碼。

```sh
npm ci
cp .env.example .env
npm run dev
```

啟動前先填好 `.env`：

- `GEMINI_API_KEY`：圖片辨識與語音生成使用。
- `BRAGI_TOTP_SECRET`：Base32 格式的 TOTP 秘密，用離線產生的 `otpauth://` QR code 加入驗證器。
- `BRAGI_SESSION_SECRET`：至少 32 bytes 的隨機值，用來簽署登入與上傳憑證。
- `BRAGI_SESSION_VERSION`：預設 `1`，改變它會讓既有登入全部失效。
- `GEMINI_OCR_MODEL`、`GEMINI_TTS_MODEL`：預設值見 `.env.example`。

打開開發伺服器顯示的網址，用 6 位數 TOTP 登入。專案使用 SolidStart、SolidJS 與 Nitro。程式分工見 [架構與資料生命週期](docs/architecture.md)，端點規格見 [API 文件](docs/api.md)。

## 測試與驗證

下面的檢查和 `.github/workflows/verify.yml` 相同。在 Ubuntu 上跑視覺測試需要 Noto CJK 字型。

```sh
npm run check
npm run typecheck
npm test
npx playwright install --with-deps chromium
sudo apt-get install -y fonts-noto-cjk
BRAGI_E2E_PORT=4194 npx playwright test --workers=4
NITRO_PRESET=vercel VERCEL=1 VERCEL_ENV=production npm run build
test -s .vercel/output/static/sw.js
```

CI 用 `npm run test:e2e` 跑同一份 Playwright 設定，預設 port 是 4173；本機有 port 衝突時用 `BRAGI_E2E_PORT` 換一個。測試會自己 build 並以正式模式啟動伺服器，API 全部是模擬回應，不耗用 Gemini 額度。另外還有啟用真實 service worker 的 PWA 測試，以及手機與平板的截圖比對。

音訊核心另有一組 Chromium 播放限制與 WebKit 的測試，目前不在 CI 裡：

```sh
npx playwright install --with-deps chromium webkit
npx playwright test --config playwright.audio-core.config.ts
```

這組測試固定使用 port 4188。瀏覽器測試取代不了真機：iOS Safari、Android Chrome 與安裝版 PWA 要驗的項目列在 [朗讀真機清單](docs/reading-device-checklist.md)。

## 部署與 PWA

部署到 Vercel 時，設定和本機相同的伺服器環境變數，並使用上面的 Vercel build。登入 cookie 有 Secure 屬性，所以正式站必須是 HTTPS。部署後可以跑一次不生成內容的 smoke test：

```sh
BRAGI_SMOKE_URL=https://bragi.0x148.com npm run test:smoke
```

可以用瀏覽器的安裝功能把 Bragi 加到主畫面。PWA 只快取公開的靜態檔案，離線時顯示說明頁；辨識與生成新語音仍然需要網路。有新版本時要先確認才會重新載入，套用前請關閉其他 Bragi 分頁。

圖示來源是 `assets/icon/icon.svg` 與 `assets/icon/icon-maskable.svg`。換圖後執行 `node scripts/build-icons.mjs`，它會用 Playwright 安裝的 Chromium 在 `public/` 產生 PNG、Apple touch icon 與 favicon。maskable 版的圖案要放在中央 80% 的圓內。部署檢查、快取與日誌的細節見 [維運文件](docs/operations.md)。

## 資料與隱私

圖片會先在裝置上轉正、縮小與壓縮，再經 Bragi 傳給 Gemini。朗讀時送出的是該段文字、語氣與故事類型提示。

- 本機暫存只有文字草稿：辨識出的語言、故事類型，以及每段的口白、語氣與發音修正。圖片、音訊、聲音選擇與登入資料都不在草稿裡，匯出的檔案也一樣。
- 字級、聲音等偏好另外存在這台裝置。登入狀態存在 HttpOnly cookie。Bragi 的伺服器不保存稿件，音訊只快取在瀏覽器記憶體。
- 草稿暫存在 localStorage。service worker 的 Cache Storage 不放 API 回應、圖片、草稿或生成的音訊。
- 上傳到 Gemini Files 的檔案會保存 48 小時，見 [Google 官方說明](https://ai.google.dev/gemini-api/docs/files)。在 Bragi 清除內容或登出，不會刪除 Gemini 那邊的檔案。
- 日誌不記錄圖片、稿件、登入憑證、上傳憑證或供應商的錯誤內文。取消請求只能讓 Bragi 停止等待，撤回不了 Gemini 已經開始的處理或計費。

## 限制與已知事項

辨識結果與發音都需要人工校對。遇到網路或供應商錯誤時要手動重試。

- 支援 JPEG、PNG、WebP、HEIC、HEIF。原始檔最大 25 MB，上傳上限 4 MB。瀏覽器無法解碼 HEIC 或 HEIF 時，4 MB 內的原檔可以直接上傳，更大的要先轉檔或重拍。
- 草稿最多 50 段、200,000 bytes，存得下比單段朗讀上限更長的文字。要朗讀的段落，口白與發音修正都不能超過 400 個字（以字素計）、2,000 UTF-8 bytes，生成的音訊最長 60 秒；太長請拆段。
- 鎖屏、來電或切到其他 App 可能中斷音訊，Bragi 不保證能在背景播放。螢幕常亮需要瀏覽器支援 Wake Lock，離開朗讀畫面就會釋放。
- 本機儲存會受隱私模式、容量與瀏覽器清理影響。存不進去時仍可繼續編輯，但下次不一定能恢復，重要的稿件請匯出。
