# Bragi interface glossary

> **Status: not yet reviewed by native speakers.** The zh-Hans, ja, ko, en, de and es strings were
> written and revised without a native-speaker pass. Please treat this table as the proposal to
> check, and update both this file and `src/lib/i18n/messages/*.ts` together.

Traditional Chinese (`zh-Hant.ts`) is the source dictionary; every other language falls back to it
key by key. OCR text, tone hints, the voice sample sentence and draft data are content and are
never translated.

## Core terms

| Concept | zh-Hant (source) | zh-Hans | ja | ko | en | de | es |
|---|---|---|---|---|---|---|---|
| Step 1: get the image | 取圖 | 取图 | 取り込み | 촬영 | Capture | Erfassen | Capturar |
| Step 2: proofread (step name) | 校對 | 校对 | 確認 | 검토 | Review | Prüfen | Revisar |
| Proofreading (the act) | 校對 | 校对 | 校正 | 교정 | review | prüfen | revisar |
| Step 3 / reading aloud | 朗讀 | 朗读 | 朗読（動作は 読み上げ） | 낭독 | Read (aloud) | Vorlesen | Leer (en voz alta) |
| Recognize text (OCR) | 辨識 | 识别 | 読み取り／認識 | 인식 | Recognize | Erkennen | Reconocer |
| Segment / part | 段落 | 段落 | 段落 | 단락 | part | Abschnitt | parte |
| Narration text (口白) | 口白文字 | 旁白文字 | 本文 | 내레이션 | Narration | Erzähltext | Narración |
| Spoken text (pronunciation fix) | 朗讀文字 | 朗读文字 | 読み上げ文 | 낭독 텍스트 | Spoken text | Vorlesetext | Texto de voz |
| Pronunciation fix | 發音修正／朗讀修正 | 发音修正／朗读修正 | 読み修正 | 발음 수정／낭독 수정 | pronunciation fix | Aussprache | corrección de pronunciación |
| Tone | 語氣 | 语气 | 口調 | 어조 | Tone | Tonfall | Tono |
| Draft | 草稿 | 草稿 | 下書き | 초안 | Draft | Entwurf | Borrador |
| Export / import | 匯出／匯入 | 导出／导入 | 書き出す／読み込む | 내보내기／가져오기 | Export / Import | Exportieren / Importieren | Exportar / Importar |
| Preview (audio) | 試聽 | 试听 | 試聴 | 미리 듣기 | Preview | Hörprobe | Muestra / Escuchar |
| Undo / redo | 復原／重做 | 撤销／重做 | 元に戻す／やり直す | 실행 취소／다시 실행 | Undo / Redo | Rückgängig / Wiederholen | Deshacer / Rehacer |
| Local autosave | 本機暫存 | 本地暂存 | 端末内の保存 | 로컬 저장 | saved on this device | lokal gespeichert | guardado localmente |
| Settings | 設定 | 设置 | 設定 | 설정 | Settings | Einstellungen | Ajustes |
| Sign-in state | 登入狀態 | 登录状态 | ログイン状態 | 로그인 상태 | signed in | angemeldet | sesión iniciada |
| Sign in / sign out | 登入／登出 | 登录／退出登录 | ログイン／ログアウト | 로그인／로그아웃 | Sign in / Sign out | Anmelden / Abmelden | Iniciar / Cerrar sesión |
| Clear current content | 清除目前內容 | 清除当前内容 | 現在の内容を消去 | 현재 내용 지우기 | Clear current content | Aktuellen Inhalt löschen | Borrar el contenido actual |
| Offline | 離線 | 离线 | オフライン | 오프라인 | offline | offline | sin conexión |
| Transcript (playback script) | 逐字稿 | 逐字稿 | 書き起こし | 대본 | Transcript | Transkript | Transcripción |
| Next story (finish page) | 下一段故事 | 下一段故事 | 次の物語 | 다음 이야기 | next story | nächste Geschichte | siguiente historia |
| Ready / preparing / not prepared | 已備妥／準備中／尚未準備 | 已就绪／准备中／尚未准备 | 準備済み／準備中／未準備 | 준비 완료／준비 중／준비 전 | Ready / Preparing / Not prepared | Bereit / In Vorbereitung / Nicht vorbereitet | Lista / Preparando / Sin preparar |
| Voice trait (Gemini's official voice character) | 特質 | 特质 | 特徴 | 특징 | trait | Merkmal | rasgo |
| Voice in use (picker badge) | 使用中 | 使用中 | 使用中 | 사용 중 | In use | Aktiv | En uso |

## Reasons for the choices

- **Sign-in state.** Account settings describe how long the device stays signed in, using everyday local terms rather than the technical session noun. Japanese uses システム for the compact appearance option.
- **Segment → "part" / Abschnitt / parte / 단락.** The v4 design drafts use "part" in English and
  Spanish, 단락 in Korean and 段落 in Japanese. The dictionaries had mixed "segment"/"part",
  "segmento"/"parte" and 문단/단락; each language now uses one word. "Part" is plainer than
  "segment" for people who are not used to audio tools.
- **口白 → narration.** 口白 is the narrator's line. The old translations used "script text",
  台詞 (spoken dialogue) and 대사 (dialogue), which suggest characters' lines. Narration / 本文 /
  내레이션 / Erzähltext / Narración follow the design drafts and match what the field holds.
- **Simplified Chinese is localized, not converted.** Mainland usage replaces Taiwan usage:
  设置 (not 设定), 界面 (介面), 登录 (登入), 退出登录 (登出), 屏幕 (萤幕), 支持 (支援), 文件 (档案),
  保存 (储存), 字段 (栏位), 默认 (预设), 光标 (游标), 字符 (字元), 撤销 (复原 for undo), 滚动 (卷动),
  流式 (串流), 生成 (产生), 识别 (辨识), 加载 (载入), 刷新 (重新整理), 打开 (开启), 标签页 (分页),
  列表 (清单), 字号 (字级), 数据与账号 (资料与帐号), 当前 (目前), and Chinese quotation marks “”
  instead of 「」.
- **Undo in Chinese.** zh-Hant keeps 復原 (Taiwan convention); zh-Hans uses 撤销, the standard
  mainland label.
- **Japanese 草稿 → 下書き.** Both appeared; 下書き is the everyday word and the one the design uses.
  確認 is the step name (short enough for the step bar), 校正 is the act in sentences.
- **Korean register.** Mixed 합니다체 and 해요체 is now 해요체 throughout, matching the friendly tone
  of the rest of the app. The interruption message now names the actual button (이어서 재생).
- **German and Spanish confirmation buttons.** "Löschen fortsetzen" / "Continuar con el cierre de
  sesión" were long and stiff. After exporting, the second button is now "Jetzt löschen",
  "Cerrar sesión ahora" and so on (English: "Clear now"). This keeps 44 px buttons on one line at
  320 px.
- **Playback and finish page (batch D).** The new strings first used "segment", "párrafo",
  "Absatz" and 문단; they now follow the part / parte / Abschnitt / 단락 rule, Korean 해요체, and
  name the real Resume button. The full-width space in "下一段　{text}" stays in Chinese and
  Japanese; Latin-script languages and Korean use "Next: {text}".
- **Voice picker (batch F2).** The trait names are Google's official one-word descriptions of each
  Gemini voice (`src/lib/voices.ts`), translated once under `voiceTrait.*`; the picker filters
  only by those, never by categories of our own. "Trait" is 特質／特徴／특징／Merkmal／rasgo,
  kept apart from 語氣 (tone of a part). Preview buttons in the list show only the action
  (試聽／Preview／Hörprobe…) and add the voice name to the accessible name, e.g. "Preview Puck".
- **Font size.** English, German and Spanish used "L" for the middle size; it is now
  Large / Groß / Grande, consistent with the other two sizes.
- **Informal address.** German uses du, Spanish uses tú, Korean uses 해요체, Japanese uses です／ます.
  These match a personal tabletop helper and must stay consistent when strings are added.
- **Names of buttons inside messages** must match the button label exactly (for example
  "Resume" / "Fortsetzen" / "Continuar" / 「再開」 / '이어서 재생').

## Checks

- `src/lib/i18n/i18n.test.ts` checks that every language has every key and the same placeholders.
- `e2e/i18n-layout.spec.ts` opens capture, review (with every disclosure open), settings and the
  voice picker (full catalog, filtered, previewing) in all
  seven languages at 390 px and 320 px. It fails if the page scrolls sideways or a button, link,
  label or summary is narrower than its text or cut off with an ellipsis.
