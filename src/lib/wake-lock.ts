type WakeLockHost = {
  navigator: { wakeLock?: Pick<WakeLock, "request"> };
  document: Pick<Document, "visibilityState">;
};

function browserHost(): WakeLockHost | undefined {
  return typeof navigator === "undefined" || typeof document === "undefined"
    ? undefined
    : { navigator, document };
}

/**
 * Keeps the screen awake while wanted. Browsers release the lock whenever the page is hidden,
 * so `reacquire` must run again once the page becomes visible.
 */
export class ScreenWakeLock {
  #wanted = false;
  #sentinel?: WakeLockSentinel;
  #pending?: Promise<void>;

  constructor(readonly host: WakeLockHost | undefined = browserHost()) {}

  get supported(): boolean {
    return Boolean(this.host?.navigator.wakeLock);
  }

  get active(): boolean {
    return Boolean(this.#sentinel && !this.#sentinel.released);
  }

  async enable(): Promise<void> {
    this.#wanted = true;
    await this.#acquire();
  }

  async disable(): Promise<void> {
    this.#wanted = false;
    await this.#pending?.catch(() => undefined);
    const sentinel = this.#sentinel;
    this.#sentinel = undefined;
    if (sentinel && !sentinel.released) await sentinel.release();
  }

  async reacquire(): Promise<void> {
    if (this.#wanted && !this.active) await this.#acquire();
  }

  async #acquire(): Promise<void> {
    const wakeLock = this.host?.navigator.wakeLock;
    if (!wakeLock || this.active || this.host?.document.visibilityState !== "visible") return;
    this.#pending ??= wakeLock
      .request("screen")
      .then(async (sentinel) => {
        if (!this.#wanted) {
          await sentinel.release();
          return;
        }
        this.#sentinel = sentinel;
      })
      .finally(() => {
        this.#pending = undefined;
      });
    await this.#pending;
  }
}
