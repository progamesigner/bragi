import { batch, createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import Capture from "~/components/Capture";
import Playback from "~/components/Playback";
import Review from "~/components/Review";
import Banner from "~/components/ui/Banner";
import Button, { buttonClass, IconButton } from "~/components/ui/Button";
import { SettingsIcon } from "~/components/ui/icons";
import Select from "~/components/ui/Select";
import Sheet from "~/components/ui/Sheet";
import Toast from "~/components/ui/Toast";
import VoiceSample from "~/components/VoiceSample";
import { readApiError } from "~/lib/api";
import { DraftAutosave } from "~/lib/autosave";
import { type Draft, MAX_DRAFT_BYTES, parseDraft, serializeDraft } from "~/lib/draft";
import { graphemeCount, MAX_DRAFT_GENRE } from "~/lib/draft-limits";
import { History } from "~/lib/editing";
import { LOCALE_NAMES, LOCALES, type Locale, t } from "~/lib/i18n";
import type { PreparedImage } from "~/lib/image";
import { requireOnline } from "~/lib/network";
import { ocrResponseSchema } from "~/lib/schemas";
import { speechCache } from "~/lib/speech-cache";
import type { Segment } from "~/lib/state";
import { reportError, type StatusMessage, type StatusReporter } from "~/lib/status";
import { locale, setLocale, setThemePreference, themePreference } from "~/lib/store/preferences";
import { THEME_PREFERENCES, type ThemePreference } from "~/lib/theme";
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
  const [status, setStatus] = createSignal<StatusMessage>({
    message: t("auth.unverified"),
    tone: "info",
  });
  const [authBusy, setAuthBusy] = createSignal(false);
  const [sessionChecking, setSessionChecking] = createSignal(true);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [recognitionBusy, setRecognitionBusy] = createSignal(false);
  const [screen, setScreen] = createSignal<"review" | "playback">("review");
  const [settingsOpen, setSettingsOpen] = createSignal(false);

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

  const reportStatus: StatusReporter = (message, tone = "info", details) => {
    setStatus({ message, tone, details });
  };

  function cancelOperation() {
    operations.invalidate();
    setRecognitionBusy(false);
  }

  function clearWorkspace() {
    cancelOperation();
    autosave.clear();
    batch(() => {
      setRequestRevision({});
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
      setRequestRevision({});
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
      if (!response.ok) throw await readApiError(response, t("auth.checkFailed"));
      const session = (await response.json()) as { authenticated: boolean; voices?: string[] };
      if (!operation.current()) return;
      setAuthenticated(session.authenticated);
      restoreVoice(session.voices ?? []);
      reportStatus(
        t(session.authenticated ? "auth.restored" : "auth.prompt"),
        session.authenticated ? "success" : "info",
      );
    } catch (error) {
      if (operation.current()) reportError(reportStatus, error, t("auth.checkFailed"));
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
      if (!response.ok) throw await readApiError(response, t("auth.failed"));
      const session = await response.json();
      if (!operation.current()) return;
      restoreVoice(session.voices ?? []);
      setAuthenticated(true);
      setOtp("");
      reportStatus(t("auth.success"), "success");
    } catch (error) {
      if (operation.current()) reportError(reportStatus, error, t("auth.failed"));
    } finally {
      if (operation.current()) setAuthBusy(false);
    }
  }

  async function signOut() {
    const operation = authOperations.begin();
    cancelOperation();
    setRequestRevision({});
    // Unmount pending image/audio operations while the logout request is in flight.
    setWorkspace({});
    setCandidate(undefined);
    autosave.clear();
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", { method: "DELETE", signal: operation.signal });
      if (!response.ok) throw await readApiError(response, t("auth.signOutFailed"));
      if (!operation.current()) return;
      setAuthenticated(false);
      clearWorkspace();
      reportStatus(t("auth.signedOut"), "success");
    } catch (error) {
      if (operation.current()) reportError(reportStatus, error, t("auth.signOutFailed"));
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
          () => window.confirm(t("draft.importConfirm")),
          (next) => {
            setCandidate(undefined);
            applyDraft(next);
          },
        )
      )
        return;
      reportStatus(t("draft.imported", { n: draft.segments.length }), "success");
    } catch (error) {
      if (operation.current())
        reportStatus(error instanceof Error ? error.message : t("draft.importFailed"), "error");
    }
  }

  async function recognizeUpload() {
    const prepared = candidate();
    if (!prepared) return;
    const selected = prepared.file;
    const genre = candidateGenre();
    const operation = operations.begin();
    setRecognitionBusy(true);
    reportStatus(t("recognize.creatingSession"));
    try {
      requireOnline();
      const sessionResponse = await fetch("/api/uploads", {
        signal: operation.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: selected.type, sizeBytes: selected.size }),
      });
      if (!sessionResponse.ok)
        throw await readApiError(sessionResponse, t("recognize.sessionFailed"));
      const upload = (await sessionResponse.json()) as UploadTarget;
      if (!operation.current()) return;
      reportStatus(t("recognize.uploading"));
      const response = await fetch(upload.target.url, {
        signal: operation.signal,
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw await readApiError(response, t("recognize.uploadFailed"));
      const receipt = await response.json();
      if (!operation.current()) return;
      reportStatus(t("recognize.analyzing"));
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
      if (!ocrResponse.ok) throw await readApiError(ocrResponse, t("recognize.ocrFailed"));
      const value: unknown = await ocrResponse.json();
      if (!operation.current()) return;
      const parsed = ocrResponseSchema.safeParse(value);
      if (!parsed.success) throw new Error(t("recognize.invalidResult"));
      const draft: Draft = { ...parsed.data, genreHint: genre || undefined };
      if (
        !commitCandidate(
          operation,
          draft,
          !!detectedLanguage(),
          () => window.confirm(t("recognize.replaceConfirm")),
          (next) => applyDraft(next, prepared),
        )
      ) {
        if (operation.current()) reportStatus(t("recognize.kept"));
        return;
      }
      reportStatus(t("recognize.done", { n: draft.segments.length }), "success");
    } catch (error) {
      if (operation.current()) reportError(reportStatus, error, t("recognize.failed"));
    } finally {
      if (operation.current()) setRecognitionBusy(false);
    }
  }

  function editGenre(input: HTMLInputElement) {
    const value = input.value;
    try {
      if (graphemeCount(value) > MAX_DRAFT_GENRE) throw new Error(t("genre.tooLong"));
      if (candidateActive()) setCandidateGenre(value);
      else {
        if (detectedLanguage())
          serializeDraft({ ...currentDraft(), genreHint: value || undefined });
        setGenreHint(value);
        setCandidateGenre(value);
      }
    } catch (error) {
      input.value = candidateActive() ? candidateGenre() : genreHint();
      reportStatus(error instanceof Error ? error.message : t("genre.editFailed"), "error");
    }
  }

  return (
    <main data-font-size={fontSize()}>
      <div class="app-bar">
        <IconButton label={t("settings.open")} onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </IconButton>
      </div>
      <Sheet
        open={settingsOpen()}
        title={t("settings.title")}
        closeLabel={t("settings.close")}
        onClose={() => setSettingsOpen(false)}
      >
        <div>
          <label for="theme">{t("settings.theme")}</label>
          <Select
            id="theme"
            value={themePreference()}
            onChange={(event) => setThemePreference(event.currentTarget.value as ThemePreference)}
          >
            <For each={THEME_PREFERENCES}>
              {(value) => <option value={value}>{t(`theme.${value}`)}</option>}
            </For>
          </Select>
        </div>
        <div>
          <label for="locale">{t("settings.language")}</label>
          <Select
            id="locale"
            value={locale()}
            onChange={(event) => setLocale(event.currentTarget.value as Locale)}
          >
            <For each={LOCALES}>
              {(value) => (
                <option value={value} lang={value}>
                  {LOCALE_NAMES[value]}
                </option>
              )}
            </For>
          </Select>
        </div>
      </Sheet>
      <header>
        <p class="eyebrow">BRAGI · OCR</p>
        <h1>
          {t("header.titleLine1")}
          <br />
          {t("header.titleLine2")}
        </h1>
        <p class="lede">{t("header.lede")}</p>
      </header>

      <section class="card">
        <h2>{t("auth.heading")}</h2>
        <Show when={!sessionChecking()} fallback={<p>{t("auth.checking")}</p>}>
          <Show
            when={authenticated()}
            fallback={
              <form onSubmit={signIn} aria-busy={authBusy()}>
                <label for="otp">{t("auth.otpLabel")}</label>
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
                  <Button type="submit" disabled={authBusy() || otp().length !== 6}>
                    {authBusy() ? t("auth.signingIn") : t("auth.signIn")}
                  </Button>
                </div>
              </form>
            }
          >
            <div class="session-state">
              <p>{t("auth.signedIn")}</p>
              <Button variant="secondary" size="compact" disabled={authBusy()} onClick={signOut}>
                {authBusy() ? t("auth.signingOut") : t("auth.signOut")}
              </Button>
            </div>
          </Show>
        </Show>
      </section>

      <section class="card">
        <label for="font-size">{t("prefs.fontSize")}</label>
        <Select
          id="font-size"
          value={fontSize()}
          onChange={(event) => {
            setFontSize(event.currentTarget.value);
            try {
              localStorage.setItem("bragi-font-size", fontSize());
            } catch {}
          }}
        >
          <option value="normal">{t("fontSize.normal")}</option>
          <option value="large">{t("fontSize.large")}</option>
          <option value="largest">{t("fontSize.largest")}</option>
        </Select>
        <Show when={authenticated() && voices().length > 1}>
          <label for="voice">{t("prefs.voice")}</label>
          <Select
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
            <option value="">
              {t("prefs.defaultVoice", { voice: voiceLabel(voices()[0] ?? "") })}
            </option>
            <For each={voices().slice(1)}>
              {(value) => <option value={value}>{voiceLabel(value)}</option>}
            </For>
          </Select>
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
        <Banner role="status" tone="warning">
          <p>{t("offline.notice")}</p>
        </Banner>
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
        <section class="card" aria-label={t("autosave.label")}>
          <p>{t("autosave.found")}</p>
          <Button
            size="compact"
            class="autosave-action"
            onClick={() => {
              if (!authenticated() || sessionChecking() || authBusy() || detectedLanguage()) return;
              const draft = savedDraft();
              if (!draft) return;
              cancelOperation();
              setCandidate(undefined);
              applyDraft(draft);
              reportStatus(t("autosave.restored"), "success");
            }}
          >
            {t("autosave.restore")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            class="autosave-action"
            onClick={() => {
              autosave.clear();
              setSavedDraft(undefined);
            }}
          >
            {t("autosave.discard")}
          </Button>
        </section>
      </Show>
      <Show when={authenticated() && workspace()} keyed>
        <Button
          variant="secondary"
          size="compact"
          onClick={() => {
            if (!window.confirm(t("workspace.clearConfirm"))) return;
            clearWorkspace();
            reportStatus(t("workspace.cleared"), "success");
          }}
        >
          {t("workspace.clear")}
        </Button>
        <section class="card" aria-busy={recognitionBusy()}>
          <h2>{t("capture.heading")}</h2>
          <p>{t("capture.intro")}</p>
          <aside class="privacy-note" id="upload-privacy" aria-labelledby="privacy-heading">
            <h3 id="privacy-heading">{t("privacy.heading")}</h3>
            <ul>
              <li>{t("privacy.local")}</li>
              <li>{t("privacy.gemini")}</li>
              <li>{t("privacy.noHistory")}</li>
            </ul>
            <p>{t("privacy.avoid")}</p>
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
              reportStatus(t("capture.candidateCancelled"));
            }}
            onChange={(prepared) => {
              setCandidate(prepared);
            }}
            onStatus={reportStatus}
          />
          <label for="genre">{t("genre.label")}</label>
          <input
            id="genre"
            type="text"
            placeholder={t("genre.placeholder")}
            disabled={recognitionBusy() || authBusy()}
            value={candidateActive() ? candidateGenre() : genreHint()}
            onInput={(event) => editGenre(event.currentTarget)}
          />
          <Button
            wide
            class="recognize"
            disabled={recognitionBusy() || !candidate() || authBusy()}
            onClick={recognizeUpload}
          >
            {recognitionBusy() ? t("recognize.busy") : t("recognize.start")}
          </Button>
          <div class="draft-import">
            <label
              class={`${buttonClass("secondary", "compact")} file-button`}
              for="draft-import"
              aria-disabled={authBusy()}
            >
              {t("draft.import")}
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
            <p id="draft-import-note">{t("draft.importNote")}</p>
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
                    reportStatus(t("playback.backDone"), "success");
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
                  reportStatus(t("playback.ready"));
                }}
                onStatus={reportStatus}
              />
            </Show>
          )}
        </Show>
      </Show>

      <Toast tone={status().tone} message={status().message} details={status().details} />
    </main>
  );
}
