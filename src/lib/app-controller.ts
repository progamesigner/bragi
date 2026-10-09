import type { Location, Navigator } from "@solidjs/router";
import {
  batch,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
} from "solid-js";
import { type ErrorDetails, onUnauthorized, readApiError } from "./api";
import { DraftAutosave } from "./autosave";
import { type Draft, MAX_DRAFT_BYTES, parseDraft, serializeDraft } from "./draft";
import { exportDraft } from "./draft-export";
import { graphemeCount, MAX_DRAFT_GENRE } from "./draft-limits";
import { t } from "./i18n";
import type { PreparedImage } from "./image";
import { describeError, requireOnline } from "./network";
import { ocrResponseSchema } from "./schemas";
import { speechCache } from "./speech-cache";
import { reportError, type StatusMessage, type StatusReporter } from "./status";
import { offerVoices } from "./store/preferences";
import { workspace } from "./store/workspace";
import { commitCandidate, type Operation, WorkspaceRevision } from "./workspace";

type UploadTarget = {
  uploadId: string;
  target: { url: string; method: "POST" | "PUT"; headers: Record<string, string> };
  expiresAt: string;
};

/**
 * - `checking`: asking the server whether this device has a session.
 * - `signed-out`: show the sign-in page.
 * - `signed-in`: the app.
 * - `expired`: an API answered 401 mid-session; the draft and screen stay while the person signs
 *   in again, and nothing is re-sent for them.
 */
export type AuthState = "checking" | "signed-out" | "signed-in" | "expired";

export type SignInResult = { ok: true } | { ok: false; message: string; details?: ErrorDetails };

export type ToastAction = { label: string; run: () => void };
export type ToastMessage = { id: number; message: string; action?: ToastAction };

/** Actions that drop the workspace and so may need the "export first" confirmation. */
export type LossAction = "clear" | "signOut" | "update";

export type AppPath = "/" | "/review" | "/play";

/** Each step's "previous page" in the top bar. */
export const PARENT_PATH: Record<AppPath, AppPath | undefined> = {
  "/": undefined,
  "/review": "/",
  "/play": "/review",
};

type NavigationState = { from?: string } | null | undefined;

/**
 * Everything the screens share: sign-in, feedback, the capture flow and the actions that drop the
 * workspace. It lives in the app shell, so moving between routes never resets it; the draft itself
 * is in the workspace store.
 */
export function createAppController(navigate: Navigator, location: Location) {
  const [online, setOnline] = createSignal(true);
  const [auth, setAuth] = createSignal<AuthState>("checking");
  const [sessionError, setSessionError] = createSignal<StatusMessage>();
  /** Signed in on the sign-in page; the success state stays until the person continues. */
  const [welcome, setWelcome] = createSignal(false);
  const [authBusy, setAuthBusy] = createSignal(false);
  const [toast, setToast] = createSignal<ToastMessage>();
  const [error, setError] = createSignal<StatusMessage>();
  const [captureStatus, setCaptureStatus] = createSignal<StatusMessage>();
  // A fresh object remounts the screens, e.g. so a new draft never shows the old one's state.
  const [view, setView] = createSignal({});
  const [requestRevision, setRequestRevision] = createSignal({});
  const [candidate, setCandidate] = createSignal<PreparedImage>();
  const [candidateActive, setCandidateActive] = createSignal(false);
  const [candidateGenre, setCandidateGenre] = createSignal("");
  const [recognitionBusy, setRecognitionBusy] = createSignal(false);
  const [savedDraft, setSavedDraft] = createSignal<Draft>();
  const [autosaveReady, setAutosaveReady] = createSignal(false);
  const [pendingLoss, setPendingLoss] = createSignal<LossAction>();
  const [updateActivator, setUpdateActivator] = createSignal<() => void>();
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  // Screens move focus to their heading only after in-app navigation, not on first load.
  const [navigated, setNavigated] = createSignal(false);
  createEffect(
    on(
      () => location.pathname,
      () => setNavigated(true),
      { defer: true },
    ),
  );
  const operations = new WorkspaceRevision();
  const authOperations = new WorkspaceRevision();
  const autosave = new DraftAutosave(() => localStorage);
  let toastId = 0;

  const currentDraft = (): Draft => ({
    detectedLanguage: workspace.detectedLanguage() ?? "未指定",
    genreHint: workspace.genreHint() || undefined,
    segments: workspace.segments.map((segment) => ({ ...segment })),
  });

  createEffect(() => {
    if (!autosaveReady() || !workspace.detectedLanguage()) return;
    autosave.schedule(currentDraft());
  });

  onUnauthorized(() => {
    if (auth() === "signed-in") setAuth("expired");
  });

  onCleanup(() => {
    onUnauthorized(undefined);
    operations.invalidate();
    authOperations.invalidate();
    autosave.dispose();
  });

  // Feedback: short results are toasts, errors that need attention are a banner. Progress and
  // results that belong next to a control (previews, recognition, import) stay next to it.
  function showToast(message: string, action?: ToastAction) {
    toastId += 1;
    setToast({ id: toastId, message, action });
  }

  const report: StatusReporter = (message, tone = "info", details) => {
    if (tone === "error") setError({ message, tone, details });
    else showToast(message);
  };

  const reportCapture: StatusReporter = (message, tone = "info", details) => {
    setCaptureStatus({ message, tone, details });
  };

  /** In-app navigation that steps back through history when the target is where we came from. */
  function goTo(path: AppPath) {
    if (location.pathname === path) return;
    const state = location.state as NavigationState;
    if (state?.from === path) {
      history.back();
      return;
    }
    navigate(path, { state: { from: location.pathname } });
  }

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
      workspace.clear();
      setCandidate(undefined);
      setCandidateActive(false);
      setCandidateGenre("");
      setSavedDraft(undefined);
      setCaptureStatus(undefined);
      setError(undefined);
      setView({});
    });
  }

  function applyDraft(
    draft: Draft,
    { prepared, saved }: { prepared?: PreparedImage; saved: boolean },
  ) {
    batch(() => {
      setRequestRevision({});
      speechCache.clear();
      workspace.load(draft, { saved });
      workspace.setImage(prepared);
      setCandidate(undefined);
      setCandidateActive(false);
      setCandidateGenre(draft.genreHint ?? "");
      setSavedDraft(undefined);
      setCaptureStatus(undefined);
      setView({});
    });
    autosave.save(draft);
    goTo("/review");
  }

  function startOnline() {
    setSavedDraft(autosave.load());
    setAutosaveReady(true);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    onCleanup(() => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    });
  }

  async function checkSession() {
    const operation = authOperations.begin();
    try {
      const response = await fetch("/api/session", { cache: "no-store", signal: operation.signal });
      if (!response.ok) throw await readApiError(response, t("auth.checkFailed"));
      const session = (await response.json()) as { authenticated: boolean; voices?: string[] };
      if (!operation.current()) return;
      offerVoices(session.voices ?? []);
      setAuth(session.authenticated ? "signed-in" : "signed-out");
    } catch (failure) {
      if (!operation.current()) return;
      const { message, details } = describeError(failure, t("auth.checkFailed"));
      setSessionError({ message, tone: "error", details });
      setAuth("signed-out");
    }
  }

  /** Verifies a one-time code; the form shows the outcome next to the field. */
  async function signIn(otp: string): Promise<SignInResult> {
    const operation = authOperations.begin();
    const renewing = auth() === "expired";
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", {
        signal: operation.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      if (!response.ok) throw await readApiError(response, t("auth.failed"));
      const session = await response.json();
      if (!operation.current()) return { ok: false, message: t("auth.failed") };
      batch(() => {
        offerVoices(session.voices ?? []);
        setSessionError(undefined);
        setAuth("signed-in");
        if (!renewing) setWelcome(true);
      });
      if (renewing) showToast(t("reauth.done"));
      return { ok: true };
    } catch (failure) {
      const { message, details } = describeError(failure, t("auth.failed"));
      return { ok: false, message, details };
    } finally {
      if (operation.current()) setAuthBusy(false);
    }
  }

  async function signOut() {
    const operation = authOperations.begin();
    cancelOperation();
    setRequestRevision({});
    // Unmount pending image/audio operations while the logout request is in flight.
    setView({});
    setCandidate(undefined);
    autosave.clear();
    setAuthBusy(true);
    try {
      requireOnline();
      const response = await fetch("/api/session", { method: "DELETE", signal: operation.signal });
      if (!response.ok) throw await readApiError(response, t("auth.signOutFailed"));
      if (!operation.current()) return;
      clearWorkspace();
      setAuth("signed-out");
      navigate("/", { replace: true });
      showToast(t("auth.signedOut"));
    } catch (failure) {
      if (operation.current()) reportError(report, failure, t("auth.signOutFailed"));
    } finally {
      if (operation.current()) setAuthBusy(false);
    }
  }

  /** True when dropping the workspace would lose text that has no copy outside this tab. */
  const contentAtRisk = () => workspace.hasDraft() && workspace.dirty();

  function perform(action: LossAction) {
    setPendingLoss(undefined);
    if (action === "clear") {
      setSettingsOpen(false);
      clearWorkspace();
      // Replace, so Back cannot return to a screen whose draft is gone.
      if (location.pathname !== "/") navigate("/", { replace: true });
      showToast(t("workspace.cleared"));
    } else if (action === "signOut") void signOut();
    else updateActivator()?.();
  }

  /** Runs the action now, or first asks (offering an export) when content would be lost. */
  function requestLoss(action: LossAction) {
    if (contentAtRisk()) setPendingLoss(action);
    else perform(action);
  }

  async function importDraft(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    cancelOperation();
    const operation = operations.begin();
    try {
      if (file.size > MAX_DRAFT_BYTES) throw new Error(t("draft.tooLargeToImport"));
      const source = await file.text();
      if (!operation.current()) return;
      const draft = parseDraft(source);
      if (
        !commitCandidate(
          operation,
          draft,
          workspace.hasDraft(),
          () => window.confirm(t("draft.importConfirm")),
          (next) => {
            setCandidate(undefined);
            applyDraft(next, { saved: true });
          },
        )
      )
        return;
      showToast(t("draft.imported", { n: draft.segments.length }));
    } catch (failure) {
      if (operation.current())
        reportCapture(
          failure instanceof Error ? failure.message : t("draft.importFailed"),
          "error",
        );
    }
  }

  async function recognize() {
    const prepared = candidate();
    if (!prepared) return;
    const selected = prepared.file;
    const genre = candidateGenre();
    const operation = operations.begin();
    setRecognitionBusy(true);
    reportCapture(t("recognize.creatingSession"));
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
      reportCapture(t("recognize.uploading"));
      const response = await fetch(upload.target.url, {
        signal: operation.signal,
        method: upload.target.method,
        headers: upload.target.headers,
        body: selected,
      });
      if (!response.ok) throw await readApiError(response, t("recognize.uploadFailed"));
      const receipt = await response.json();
      if (!operation.current()) return;
      reportCapture(t("recognize.analyzing"));
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
          workspace.hasDraft(),
          () => window.confirm(t("recognize.replaceConfirm")),
          (next) => applyDraft(next, { prepared, saved: false }),
        )
      ) {
        if (operation.current()) reportCapture(t("recognize.kept"));
        return;
      }
      showToast(t("recognize.done", { n: draft.segments.length }));
    } catch (failure) {
      if (operation.current()) reportError(reportCapture, failure, t("recognize.failed"));
    } finally {
      if (operation.current()) setRecognitionBusy(false);
    }
  }

  return {
    online,
    auth,
    authBusy,
    sessionError,
    welcome,
    /** Leaves the sign-in success state for the app. */
    enter: () => setWelcome(false),
    signedIn: () => auth() === "signed-in" || auth() === "expired",
    toast,
    dismissToast: () => setToast(undefined),
    error,
    dismissError: () => setError(undefined),
    captureStatus,
    view,
    requestRevision,
    candidate,
    candidateActive,
    candidateGenre,
    recognitionBusy,
    savedDraft,
    pendingLoss,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    navigated,
    setUpdateActivator: (activate: (() => void) | undefined) => setUpdateActivator(() => activate),

    report,
    reportCapture,
    showToast,
    goTo,
    startOnline,
    checkSession,
    signIn,
    signOut,
    contentAtRisk,
    requestLoss,
    perform,
    cancelLoss: () => setPendingLoss(undefined),
    /** Best effort: a blocked download still counts as tried, so the person decides what is next. */
    exportForLoss(): boolean {
      try {
        exportDraft();
        return true;
      } catch (failure) {
        report(failure instanceof Error ? failure.message : t("draft.exportFailed"), "error");
        return false;
      }
    },
    importDraft,
    recognize,

    /** A new candidate image: earlier capture work stops, the draft stays until it is replaced. */
    selectCandidate(): Operation {
      cancelOperation();
      setCandidate(undefined);
      setCandidateActive(true);
      setCandidateGenre(workspace.genreHint());
      return operations.begin();
    },
    setCandidate,
    cancelCandidate() {
      cancelOperation();
      setCandidate(undefined);
      setCandidateActive(false);
      reportCapture(t("capture.candidateCancelled"));
    },
    editGenre(input: HTMLInputElement) {
      const value = input.value;
      try {
        if (graphemeCount(value) > MAX_DRAFT_GENRE) throw new Error(t("genre.tooLong"));
        if (candidateActive()) setCandidateGenre(value);
        else {
          if (workspace.detectedLanguage())
            serializeDraft({ ...currentDraft(), genreHint: value || undefined });
          workspace.setGenreHint(value);
          setCandidateGenre(value);
        }
      } catch (failure) {
        input.value = candidateActive() ? candidateGenre() : workspace.genreHint();
        reportCapture(failure instanceof Error ? failure.message : t("genre.editFailed"), "error");
      }
    },
    restoreAutosave() {
      if (auth() !== "signed-in" || authBusy() || workspace.hasDraft()) return;
      const draft = savedDraft();
      if (!draft) return;
      cancelOperation();
      setCandidate(undefined);
      applyDraft(draft, { saved: false });
      showToast(t("autosave.restored"));
    },
    discardAutosave() {
      autosave.clear();
      setSavedDraft(undefined);
    },
  };
}

export type AppController = ReturnType<typeof createAppController>;

export const AppContext = createContext<AppController>();

export function useApp(): AppController {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside the app shell");
  return app;
}
